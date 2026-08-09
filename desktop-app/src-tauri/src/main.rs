// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RpcRequest {
    id: String,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RpcResponse {
    id: String,
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
}

struct AgentRuntimeProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for AgentRuntimeProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct AgentRuntimeState {
    process: Arc<Mutex<Option<AgentRuntimeProcess>>>,
}

fn spawn_agent_runtime() -> Result<AgentRuntimeProcess, String> {
    let script = agent_runtime_script()?;
    let output = Command::new("node")
        .arg("--version")
        .output()
        .map_err(|error| format!("启动 Agent 需要 Node.js: {error}"))?;
    if !output.status.success() {
        return Err("当前设备没有可用的 Node.js 运行时".to_string());
    }
    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 Agent 进程失败: {error}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "无法打开 Agent 输入通道".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "无法打开 Agent 输出通道".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() {
                if line.is_empty() { break; }
                line.clear();
            }
        });
    }
    Ok(AgentRuntimeProcess { child, stdin, stdout: BufReader::new(stdout) })
}

#[tauri::command]
fn start_agent_runtime(state: State<'_, AgentRuntimeState>) -> Result<String, String> {
    let mut process = state.process.lock().map_err(|_| "Agent runtime 状态锁定失败".to_string())?;
    let script = agent_runtime_script()?;
    let running = process.as_mut().map(|runtime| runtime.child.try_wait().map(|status| status.is_none()).unwrap_or(false)).unwrap_or(false);
    if !running {
        if let Some(mut old) = process.take() { let _ = old.child.kill(); }
        *process = Some(spawn_agent_runtime()?);
    }
    Ok(format!("Agent runtime ready: {}", script.display()))
}

#[tauri::command]
fn call_agent_rpc_blocking(app: tauri::AppHandle, process: Arc<Mutex<Option<AgentRuntimeProcess>>>, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut runtime = process.lock().map_err(|_| "Agent runtime 状态锁定失败".to_string())?;
    let needs_spawn = runtime.as_mut().map(|process| process.child.try_wait().map(|status| status.is_some()).unwrap_or(true)).unwrap_or(true);
    if needs_spawn {
        if let Some(mut old) = runtime.take() { let _ = old.child.kill(); }
        *runtime = Some(spawn_agent_runtime()?);
    }
    let process = runtime.as_mut().ok_or_else(|| "Agent runtime 未启动".to_string())?;
    let request = serde_json::json!({ "id": 1, "method": method, "params": params });
    process.stdin.write_all(format!("{}\n", request).as_bytes()).map_err(|error| format!("发送 Agent 请求失败: {error}"))?;
    process.stdin.flush().map_err(|error| format!("刷新 Agent 请求失败: {error}"))?;
    let mut response: Option<Value> = None;
    for line in process.stdout.by_ref().lines() {
        let line = line.map_err(|error| format!("读取 Agent 进度失败: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let payload: Value = serde_json::from_str(&line)
            .map_err(|error| format!("解析 Agent 输出失败: {error}"))?;
        if payload.get("type").and_then(Value::as_str) == Some("agent_stream") {
            if let Some(event) = payload.get("event") {
                let mut event = event.clone();
                if let Some(run_id) = payload.get("runId") {
                    event["runId"] = run_id.clone();
                }
                app.emit("agent-progress", event)
                    .map_err(|error| format!("发送 Agent 进度失败: {error}"))?;
            }
            continue;
        }
        response = Some(payload);
        break;
    }
    let response = response.ok_or_else(|| "Agent 没有返回结果".to_string())?;
    if let Some(error) = response.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Agent 执行失败")
            .to_string());
    }
    Ok(response.get("result").cloned().unwrap_or(response))
}

#[tauri::command]
async fn call_agent_rpc(app: tauri::AppHandle, state: State<'_, AgentRuntimeState>, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let process = state.process.clone();
    tauri::async_runtime::spawn_blocking(move || call_agent_rpc_blocking(app, process, method, params))
        .await
        .map_err(|error| format!("Agent 任务线程退出：{error}"))?
}

#[tauri::command]
fn publish_fanqie(app: tauri::AppHandle, payload: Value) -> Result<Value, String> {
    let script_candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fanqie_publish.py"),
        app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("." )).join("fanqie_publish.py"),
    ];
    let script = script_candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "找不到番茄发布脚本".to_string())?;
    let input = serde_json::to_vec(&payload).map_err(|error| format!("序列化发布参数失败: {error}"))?;
    let mut last_error = String::new();
    for executable in ["python", "python3", "/opt/anaconda3/bin/python"] {
        let mut child = match Command::new(executable)
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&input).map_err(|error| format!("发送发布参数失败: {error}"))?;
        }
        let output = child.wait_with_output().map_err(|error| format!("等待番茄发布失败: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = stdout.lines().rev().find(|line| !line.trim().is_empty()) {
            let parsed: Value = serde_json::from_str(line).map_err(|error| format!("解析番茄发布结果失败: {error}"))?;
            if parsed.get("status").and_then(Value::as_str) == Some("missing_runtime") {
                last_error = parsed.get("message").and_then(Value::as_str).unwrap_or("Python Playwright 不可用").to_string();
                continue;
            }
            return Ok(parsed);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        last_error = if stderr.is_empty() { format!("{executable} 退出状态 {}", output.status) } else { stderr };
    }
    Err(format!("找不到可用 Python 运行时：{last_error}"))
}

fn agent_runtime_script() -> Result<PathBuf, String> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../sidecars/agent-runtime/dist/main.js"),
        PathBuf::from("../sidecars/agent-runtime/dist/main.js"),
        PathBuf::from("sidecars/agent-runtime/dist/main.js"),
    ];
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "找不到 Agent runtime，请先构建 sidecars/agent-runtime".to_string())
}

fn app_data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定应用数据目录: {error}"))?;
    Ok(directory)
}

#[tauri::command]
fn load_projects(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let app_data = app_data_directory(&app)?;
    let root = app_data.join("projects");

    if root.exists() {
        let mut projects = Vec::new();
        let mut entries: Vec<_> = fs::read_dir(&root)
            .map_err(|error| format!("读取小说目录失败: {error}"))?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .collect();
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let project_dir = entry.path();
            let metadata_path = project_dir.join("metadata.json");
            if !metadata_path.exists() {
                continue;
            }
            let metadata_content = fs::read_to_string(&metadata_path)
                .map_err(|error| format!("读取小说元数据失败: {error}"))?;
            let mut project: Value = serde_json::from_str(&metadata_content)
                .map_err(|error| format!("小说元数据格式错误: {error}"))?;

            if let Some(chapters) = project.get_mut("chapters").and_then(Value::as_array_mut) {
                for chapter in chapters {
                    let chapter_title = chapter
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("未命名章节");
                    let chapter_path = project_dir
                        .join("章节")
                        .join(format!("{}.md", safe_file_name(chapter_title)));
                    let legacy_chapter_id = chapter.get("id").and_then(Value::as_i64).unwrap_or(0);
                    let legacy_path = project_dir
                        .join("novel")
                        .join("chapters")
                        .join(format!("chapter-{legacy_chapter_id}.md"));
                    let source_path = if chapter_path.exists() {
                        chapter_path
                    } else {
                        legacy_path
                    };
                    if source_path.exists() {
                        let content = fs::read_to_string(source_path)
                            .map_err(|error| format!("读取章节 Markdown 失败: {error}"))?;
                        chapter["content"] = Value::String(content);
                    }
                }
            }

            if let Some(outlines) = project.get_mut("outlines").and_then(Value::as_array_mut) {
                for outline in outlines {
                    let title = outline
                        .get("title")
                        .and_then(Value::as_str)
                        .or_else(|| outline.get("kind").and_then(Value::as_str))
                        .unwrap_or("大纲");
                    let path = project_dir
                        .join("大纲")
                        .join(format!("{}.md", safe_file_name(title)));
                    if path.exists() {
                        if let Ok(content) = fs::read_to_string(path) {
                            outline["content"] = Value::String(content);
                        }
                    }
                }
            }
            if let Some(cards) = project.get_mut("cards").and_then(Value::as_array_mut) {
                for card in cards {
                    let card_type = card.get("type").and_then(Value::as_str).unwrap_or("角色卡");
                    let title = card
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("未命名卡片");
                    let path = project_dir
                        .join("卡片")
                        .join(card_type)
                        .join(format!("{}.md", safe_file_name(title)));
                    if path.exists() {
                        if let Ok(content) = fs::read_to_string(path) {
                            let (body, state_section) = content.split_once("\n## 当前状态\n").map(|(body, state)| (body, Some(state))).unwrap_or((content.as_str(), None));
                            card["content"] = Value::String(body.to_string());
                            if card.get("currentState").and_then(Value::as_str).unwrap_or("").trim().is_empty() {
                                if let Some(state) = state_section {
                                    let state = state.split("\n## 状态历史\n").next().unwrap_or(state).trim();
                                    if !state.is_empty() && state != "暂无" { card["currentState"] = Value::String(state.to_string()); }
                                }
                            }
                        }
                    }
                }
            }
            // Chapter snapshots stay structured in metadata; aggregated documents are user-editable
            // Markdown, so read their file contents back into the project on every launch.
            if let Some(documents) = project.get_mut("memoryDocuments").and_then(Value::as_array_mut) {
                for document in documents {
                    let title = document
                        .get("title")
                        .or_else(|| document.get("kind"))
                        .and_then(Value::as_str)
                        .unwrap_or("章节快照");
                    let path = project_dir
                        .join("记忆")
                        .join(format!("{}.md", safe_file_name(title)));
                    if let Ok(content) = fs::read_to_string(path) {
                        document["content"] = Value::String(content);
                    }
                }
            }
            projects.push(project);
        }

        if !projects.is_empty() {
            return Ok(Some(Value::Array(projects)));
        }
    }

    // 兼容上一版单文件存储，下一次保存时会自动拆分为目录结构。
    let legacy_path = app_data.join("projects.json");
    if legacy_path.exists() {
        let content = fs::read_to_string(&legacy_path)
            .map_err(|error| format!("读取旧版小说文件失败: {error}"))?;
        let projects = serde_json::from_str(&content)
            .map_err(|error| format!("旧版小说文件格式错误: {error}"))?;
        return Ok(Some(projects));
    }

    Ok(None)
}

#[tauri::command]
fn save_projects(app: tauri::AppHandle, projects: Value) -> Result<String, String> {
    let app_data = app_data_directory(&app)?;
    let root = app_data.join("projects");
    fs::create_dir_all(&root).map_err(|error| format!("创建小说目录失败: {error}"))?;
    let project_array = projects
        .as_array()
        .ok_or_else(|| "小说数据必须是数组".to_string())?;

    let mut current_directories = Vec::new();
    let mut used_directory_names = HashSet::new();
    for project in project_array {
        let id = project.get("id").and_then(Value::as_i64).unwrap_or(0);
        let title = project
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("未命名小说");
        let base = safe_folder_name(title);
        let mut directory_name = base.clone();
        if !used_directory_names.insert(directory_name.clone()) {
            directory_name = format!("{base}-{id}");
            used_directory_names.insert(directory_name.clone());
        }
        current_directories.push(directory_name);
    }

    // 删除已在应用中删除的小说目录，避免留下用户误以为仍存在的旧项目。
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
        {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !current_directories.contains(&name) {
                fs::remove_dir_all(entry.path())
                    .map_err(|error| format!("清理旧小说目录失败: {error}"))?;
            }
        }
    }

    for (index, project) in project_array.iter().enumerate() {
        project
            .get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "小说缺少有效 ID".to_string())?;
        let project_dir = root.join(&current_directories[index]);
        let chapters_dir = project_dir.join("章节");
        let outline_dir = project_dir.join("大纲");
        let cards_dir = project_dir.join("卡片");
        let memories_dir = project_dir.join("记忆");
        fs::create_dir_all(&chapters_dir).map_err(|error| format!("创建章节目录失败: {error}"))?;
        fs::create_dir_all(&outline_dir).map_err(|error| format!("创建大纲目录失败: {error}"))?;
        fs::create_dir_all(&cards_dir).map_err(|error| format!("创建卡片目录失败: {error}"))?;
        fs::create_dir_all(&memories_dir).map_err(|error| format!("创建记忆目录失败: {error}"))?;
        if let Ok(entries) = fs::read_dir(&chapters_dir) {
            for entry in entries.filter_map(Result::ok).filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("md")
            }) {
                fs::remove_file(entry.path())
                    .map_err(|error| format!("清理旧章节 Markdown 失败: {error}"))?;
            }
        }
        if let Ok(entries) = fs::read_dir(&outline_dir) {
            for entry in entries.filter_map(Result::ok).filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("md")
            }) {
                fs::remove_file(entry.path())
                    .map_err(|error| format!("清理旧大纲 Markdown 失败: {error}"))?;
            }
        }
        if let Ok(entries) = fs::read_dir(&cards_dir) {
            for entry in entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
            {
                if let Ok(files) = fs::read_dir(entry.path()) {
                    for file in files.filter_map(Result::ok).filter(|file| {
                        file.path().extension().and_then(|value| value.to_str()) == Some("md")
                    }) {
                        fs::remove_file(file.path())
                            .map_err(|error| format!("清理旧卡片 Markdown 失败: {error}"))?;
                    }
                }
            }
        }

        let mut metadata = project.clone();
        if let Some(chapters) = metadata.get_mut("chapters").and_then(Value::as_array_mut) {
            for chapter in chapters.iter_mut() {
                let content = chapter.get("content").and_then(Value::as_str).unwrap_or("");
                let chapter_title = chapter
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("未命名章节");
                fs::write(
                    chapters_dir.join(format!("{}.md", safe_file_name(chapter_title))),
                    content,
                )
                .map_err(|error| format!("保存章节 Markdown 失败: {error}"))?;
                chapter["content"] = Value::String(String::new());
            }
        }

        if let Some(outlines) = metadata.get_mut("outlines").and_then(Value::as_array_mut) {
            for outline in outlines.iter_mut() {
                let title = outline
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("大纲");
                let content = outline.get("content").and_then(Value::as_str).unwrap_or("");
                fs::write(
                    outline_dir.join(format!("{}.md", safe_file_name(title))),
                    content,
                )
                .map_err(|error| format!("保存大纲 Markdown 失败: {error}"))?;
                outline["content"] = Value::String(String::new());
            }
        }
        // 兼容旧版本的树形大纲，同时让目录中始终存在可打开的大纲文件。
        if metadata
            .get("outlines")
            .and_then(Value::as_array)
            .map(|items| items.is_empty())
            .unwrap_or(true)
        {
            let outline_markdown = outline_to_markdown(project.get("outline"));
            fs::write(outline_dir.join("大纲.md"), outline_markdown)
                .map_err(|error| format!("保存大纲 Markdown 失败: {error}"))?;
        }

        if let Some(cards) = metadata.get_mut("cards").and_then(Value::as_array_mut) {
            for card in cards.iter_mut() {
                let card_type = card.get("type").and_then(Value::as_str).unwrap_or("角色卡");
                let title = card
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("未命名卡片");
                let content = card.get("content").and_then(Value::as_str).unwrap_or("");
                let current_state = card.get("currentState").and_then(Value::as_str).unwrap_or("");
                let state_history = card.get("stateHistory").and_then(Value::as_array).map(|items| {
                    items.iter().rev().take(5).filter_map(|item| {
                        let chapter_title = item.get("chapterTitle").and_then(Value::as_str).unwrap_or("全文检索");
                        let changes = item.get("changes").and_then(Value::as_str).unwrap_or("");
                        if changes.trim().is_empty() { None } else { Some(format!("- {chapter_title}：{changes}")) }
                    }).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
                }).unwrap_or_default();
                let type_dir = cards_dir.join(card_type);
                fs::create_dir_all(&type_dir)
                    .map_err(|error| format!("创建卡片分类目录失败: {error}"))?;
                fs::write(
                    type_dir.join(format!("{}.md", safe_file_name(title))),
                    format!("{content}\n\n## 当前状态\n{}\n\n## 状态历史\n{}\n", if current_state.trim().is_empty() { "暂无" } else { current_state }, if state_history.trim().is_empty() { "- 暂无" } else { &state_history }),
                )
                .map_err(|error| format!("保存卡片 Markdown 失败: {error}"))?;
                card["content"] = Value::String(String::new());
            }
        }
        if let Some(memories) = metadata.get_mut("memories").and_then(Value::as_array_mut) {
            for memory in memories.iter_mut() {
                let title = memory
                    .get("chapterTitle")
                    .and_then(Value::as_str)
                    .unwrap_or("章节记忆");
                let content = chapter_memory_to_markdown(memory);
                fs::write(
                    memories_dir.join(format!("{}.md", safe_file_name(title))),
                    content,
                )
                .map_err(|error| format!("保存章节记忆 Markdown 失败: {error}"))?;
            }
        }
        if let Some(documents) = metadata.get_mut("memoryDocuments").and_then(Value::as_array_mut) {
            for document in documents.iter_mut() {
                let title = document
                    .get("title")
                    .or_else(|| document.get("kind"))
                    .and_then(Value::as_str)
                    .unwrap_or("章节快照");
                let content = document.get("content").and_then(Value::as_str).unwrap_or("");
                fs::write(
                    memories_dir.join(format!("{}.md", safe_file_name(title))),
                    content,
                )
                .map_err(|error| format!("保存聚合记忆 Markdown 失败: {error}"))?;
            }
        }

        let metadata_content = serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("序列化小说元数据失败: {error}"))?;
        fs::write(project_dir.join("metadata.json"), metadata_content)
            .map_err(|error| format!("保存小说元数据失败: {error}"))?;
    }

    let legacy_path = app_data.join("projects.json");
    if legacy_path.exists() {
        let _ = fs::remove_file(legacy_path);
    }
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
fn projects_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app_data_directory(&app)?
        .join("projects")
        .to_string_lossy()
        .into_owned())
}

fn find_project_directory(app: &tauri::AppHandle, project_id: i64) -> Result<PathBuf, String> {
    let root = app_data_directory(app)?.join("projects");
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
        {
            let metadata_path = entry.path().join("metadata.json");
            if let Ok(content) = fs::read_to_string(metadata_path) {
                if serde_json::from_str::<Value>(&content)
                    .ok()
                    .and_then(|value| value.get("id").and_then(Value::as_i64))
                    == Some(project_id)
                {
                    return Ok(entry.path());
                }
            }
        }
    }
    Err("找不到这本小说的本地目录".to_string())
}

fn reveal_location(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    Command::new("open")
        .args(["-R"])
        .arg(path)
        .status()
        .map_err(|error| format!("打开文件位置失败: {error}"))?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status()
        .map_err(|error| format!("打开文件位置失败: {error}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .status()
        .map_err(|error| format!("打开文件位置失败: {error}"))?;
    Ok(())
}

#[tauri::command]
fn open_project_location(app: tauri::AppHandle, project_id: i64) -> Result<String, String> {
    let target = find_project_directory(&app, project_id)?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&target)
        .status()
        .map_err(|error| format!("打开文件夹失败: {error}"))?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&target)
        .status()
        .map_err(|error| format!("打开文件夹失败: {error}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&target)
        .status()
        .map_err(|error| format!("打开文件夹失败: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_chapter_location(
    app: tauri::AppHandle,
    project_id: i64,
    chapter_title: String,
) -> Result<String, String> {
    let path = find_project_directory(&app, project_id)?
        .join("章节")
        .join(format!("{}.md", safe_file_name(&chapter_title)));
    if !path.exists() {
        return Err("章节 Markdown 尚未保存，请稍后再试".to_string());
    }
    reveal_location(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_outline_location(
    app: tauri::AppHandle,
    project_id: i64,
    outline_title: Option<String>,
) -> Result<String, String> {
    let title = outline_title.unwrap_or_else(|| "大纲".to_string());
    let path = find_project_directory(&app, project_id)?
        .join("大纲")
        .join(format!("{}.md", safe_file_name(&title)));
    if !path.exists() {
        return Err("大纲 Markdown 尚未保存，请稍后再试".to_string());
    }
    reveal_location(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_card_location(
    app: tauri::AppHandle,
    project_id: i64,
    card_type: String,
    card_title: String,
) -> Result<String, String> {
    let path = find_project_directory(&app, project_id)?
        .join("卡片")
        .join(safe_file_name(&card_type))
        .join(format!("{}.md", safe_file_name(&card_title)));
    if !path.exists() {
        return Err("卡片 Markdown 尚未保存，请稍后再试".to_string());
    }
    reveal_location(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

fn safe_folder_name(value: &str) -> String {
    let cleaned: String = value
        .trim()
        .chars()
        .map(|character| {
            if "\\/:*?\"<>|".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ']).trim();
    if cleaned.is_empty() {
        "未命名小说".to_string()
    } else {
        cleaned.to_string()
    }
}

fn safe_file_name(value: &str) -> String {
    let name = safe_folder_name(value);
    if name.is_empty() {
        "未命名".to_string()
    } else {
        name
    }
}

fn markdown_list(memory: &Value, field: &str) -> String {
    memory
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            let rendered = items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| !item.trim().is_empty())
                .map(|item| format!("- {item}"))
                .collect::<Vec<_>>();
            if rendered.is_empty() { "- 暂无".to_string() } else { rendered.join("\n") }
        })
        .unwrap_or_else(|| "- 暂无".to_string())
}

fn chapter_memory_to_markdown(memory: &Value) -> String {
    let title = memory
        .get("chapterTitle")
        .and_then(Value::as_str)
        .unwrap_or("章节记忆");
    let summary = memory.get("summary").and_then(Value::as_str).unwrap_or("暂无摘要");
    let ending_hook = memory.get("endingHook").and_then(Value::as_str).unwrap_or("暂无");
    format!(
        "# {title} 记忆快照\n\n## 章节摘要\n{summary}\n\n## 关键词\n{}\n\n## 人物状态变化\n{}\n\n## 角色认知变化\n{}\n\n## 伏笔变化\n{}\n\n## 时间线事件\n{}\n\n## 设定事实\n{}\n\n## 冲突\n{}\n\n## 章末钩子\n{ending_hook}\n",
        markdown_list(memory, "keywords"),
        markdown_list(memory, "characterStateChanges"),
        markdown_list(memory, "knowledgeChanges"),
        markdown_list(memory, "foreshadowingChanges"),
        markdown_list(memory, "timelineEvents"),
        markdown_list(memory, "canonFacts"),
        markdown_list(memory, "conflicts"),
    )
}

fn outline_to_markdown(outline: Option<&Value>) -> String {
    fn visit(nodes: &[Value], output: &mut String, depth: usize) {
        for node in nodes {
            let title = node
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("未命名节点");
            let description = node
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            output.push_str(&format!("{} {}\n", "#".repeat((depth + 1).min(6)), title));
            if !description.is_empty() {
                output.push_str(description);
                output.push_str("\n\n");
            }
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                visit(children, output, depth + 1);
            }
        }
    }

    let mut output = String::from("# 小说大纲\n\n");
    if let Some(nodes) = outline.and_then(Value::as_array) {
        visit(nodes, &mut output, 0);
    }
    output
}

#[tauri::command]
fn detect_system_proxy() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("scutil").arg("--proxy").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut http_enabled = false;
            let mut https_enabled = false;
            let mut host = String::new();
            let mut port = String::new();
            for line in text.lines() {
                let mut parts = line.splitn(2, ':').map(str::trim);
                let key = parts.next().unwrap_or_default();
                let value = parts.next().unwrap_or_default();
                match key {
                    "HTTPEnable" => http_enabled = value == "1",
                    "HTTPSEnable" => https_enabled = value == "1",
                    "HTTPProxy" | "HTTPSProxy" if host.is_empty() => host = value.to_string(),
                    "HTTPPort" | "HTTPSPort" if port.is_empty() => port = value.to_string(),
                    _ => {}
                }
            }
            if (http_enabled || https_enabled) && !host.is_empty() && !port.is_empty() {
                return Ok(Some(format!("http://{host}:{port}")));
            }
        }
    }
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return Ok(Some(value.trim().to_string()));
            }
        }
    }
    Ok(None)
}

fn main() {
    tauri::Builder::default()
        .manage(AgentRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            start_agent_runtime,
            call_agent_rpc,
            publish_fanqie,
            load_projects,
            save_projects,
            projects_storage_path,
            open_project_location,
            open_chapter_location,
            open_outline_location,
            open_card_location,
            detect_system_proxy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
