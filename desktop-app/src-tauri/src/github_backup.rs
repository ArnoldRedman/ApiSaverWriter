use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;

use super::{copy_cloud_backup_contents, find_project_directory};
use super::project_store::app_data_directory;
use super::runtime::{call_agent_rpc, AgentRuntimeState};

const GITHUB_PROJECT_MARKER: &str = ".zhizhang-project.json";
const GITHUB_PROJECT_KIND: &str = "zhizhang-project";
/// 改名前写出的标记文件与 kind，只用于识别既有备份仓库，不再写出
const LEGACY_GITHUB_PROJECT_MARKER: &str = ".apisaverwriter-project.json";
const LEGACY_GITHUB_PROJECT_KIND: &str = "apisaverwriter-project";
const GITHUB_PROJECT_DATA: &str = "project.json";
const GITHUB_MANAGED_PATHS: [&str; 8] = [
    GITHUB_PROJECT_MARKER,
    GITHUB_PROJECT_DATA,
    "metadata.json",
    "章节",
    "大纲",
    "卡片",
    "记忆",
    "图谱",
];

pub fn validate_github_repository_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("请先填写 GitHub 仓库链接".to_string());
    }
    if trimmed.contains('?') || trimmed.contains('#') || trimmed.contains(char::is_whitespace) {
        return Err("GitHub 仓库链接格式无效".to_string());
    }
    let path = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .or_else(|| trimmed.strip_prefix("ssh://git@github.com/"))
        .ok_or_else(|| "仅支持 GitHub HTTPS 或 SSH 仓库链接".to_string())?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts = path.split('/').collect::<Vec<_>>();
    let valid_part = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.contains("..")
            && part.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    };
    if parts.len() != 2 || !parts.iter().all(|part| valid_part(part)) {
        return Err("GitHub 仓库链接必须是 owner/repository 格式".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn run_git(args: &[&str], working_directory: Option<&Path>) -> Result<String, String> {
    let mut command = Command::new("git");
    if let Some(directory) = working_directory {
        command.current_dir(directory);
    }
    let output = command
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(args)
        .output()
        .map_err(|error| format!("无法启动 Git，请先安装 Git 并完成 GitHub 登录: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let detail = if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { format!("退出码 {}", output.status) };
        return Err(format!("Git 操作失败（git {}）：{detail}", args.first().copied().unwrap_or_default()));
    }
    Ok(if !stdout.is_empty() { stdout } else { stderr })
}

pub fn clone_github_repository(app_data: &Path, repository_url: &str, cache_name: &str) -> Result<PathBuf, String> {
    run_git(&["--version"], None)?;
    let root = app_data.join(cache_name);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| format!("清理 Git 临时目录失败: {error}"))?;
    }
    fs::create_dir_all(&root).map_err(|error| format!("创建 Git 临时目录失败: {error}"))?;
    let checkout = root.join("repository");
    let checkout_text = checkout.to_string_lossy().into_owned();
    run_git(&["clone", "--depth", "1", repository_url, &checkout_text], None)?;
    Ok(checkout)
}

pub fn read_github_project(checkout: &Path) -> Result<Value, String> {
    let project_path = checkout.join(GITHUB_PROJECT_DATA);
    let regular_file = |path: &Path| fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false);
    // 改名前建的备份仓库用的是旧标记名，恢复时两种都认
    let marker_path = [GITHUB_PROJECT_MARKER, LEGACY_GITHUB_PROJECT_MARKER]
        .into_iter()
        .map(|name| checkout.join(name))
        .find(|path| regular_file(path));
    let Some(marker_path) = marker_path else {
        return Err("该仓库不是规范的织章小说备份仓库".to_string());
    };
    if !regular_file(&project_path) {
        return Err("该仓库不是规范的织章小说备份仓库".to_string());
    }
    let marker: Value = serde_json::from_str(&fs::read_to_string(marker_path)
        .map_err(|error| format!("读取 GitHub 备份标记失败: {error}"))?)
        .map_err(|error| format!("GitHub 备份标记格式错误: {error}"))?;
    let kind = marker.get("kind").and_then(Value::as_str).unwrap_or_default();
    if (kind != GITHUB_PROJECT_KIND && kind != LEGACY_GITHUB_PROJECT_KIND)
        || marker.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0) != 1
    {
        return Err("该仓库的织章备份格式不受支持".to_string());
    }
    let project: Value = serde_json::from_str(&fs::read_to_string(project_path)
        .map_err(|error| format!("读取 GitHub 小说数据失败: {error}"))?)
        .map_err(|error| format!("GitHub 小说数据格式错误: {error}"))?;
    let project_id = project.get("id").and_then(Value::as_i64).unwrap_or(0);
    let project_title = project.get("title").and_then(Value::as_str).unwrap_or_default().trim();
    let chapters = project.get("chapters").and_then(Value::as_array);
    if project_id <= 0
        || project_title.is_empty()
        || chapters.is_none()
        || chapters.is_some_and(|items| items.iter().any(|item| !item.is_object()))
    {
        return Err("GitHub 仓库中的小说数据不完整".to_string());
    }
    if marker.get("projectId").and_then(Value::as_i64) != Some(project_id)
        || marker.get("title").and_then(Value::as_str) != Some(project_title)
    {
        return Err("GitHub 备份标记与小说数据不一致".to_string());
    }
    Ok(project)
}

pub fn validate_github_backup_destination(checkout: &Path, project_id: i64, project_title: &str) -> Result<(), String> {
    if checkout.join(GITHUB_PROJECT_MARKER).exists() {
        let existing = read_github_project(checkout)?;
        let same_id = existing.get("id").and_then(Value::as_i64) == Some(project_id);
        let same_title = existing.get("title").and_then(Value::as_str) == Some(project_title);
        if !same_id && !same_title {
            return Err("该仓库已绑定另一部小说，为避免覆盖已拒绝备份".to_string());
        }
        return Ok(());
    }
    let allowed = ["readme.md", "license", "license.md", ".gitignore", ".gitattributes"];
    let has_other_files = fs::read_dir(checkout)
        .map_err(|error| format!("读取 GitHub 仓库失败: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase())
        .any(|name| name != ".git" && !allowed.contains(&name.as_str()));
    if has_other_files {
        return Err("仓库已有其他内容且不是织章规范仓库，为避免覆盖已拒绝备份".to_string());
    }
    Ok(())
}

pub fn ensure_git_identity(checkout: &Path) -> Result<(), String> {
    if run_git(&["config", "user.name"], Some(checkout)).unwrap_or_default().trim().is_empty() {
        run_git(&["config", "user.name", "Zhizhang"], Some(checkout))?;
    }
    if run_git(&["config", "user.email"], Some(checkout)).unwrap_or_default().trim().is_empty() {
        run_git(&["config", "user.email", "zhizhang@local.invalid"], Some(checkout))?;
    }
    Ok(())
}

fn text_excerpt(value: &str, limit: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let characters = compact.chars().collect::<Vec<_>>();
    if characters.len() <= limit { return compact; }
    let head = limit * 2 / 3;
    let tail = limit - head;
    format!("{}…{}", characters[..head].iter().collect::<String>(), characters[characters.len() - tail..].iter().collect::<String>())
}

fn project_chapter_map(project: Option<&Value>) -> std::collections::BTreeMap<String, (String, String)> {
    let mut result = std::collections::BTreeMap::new();
    let chapters = project.and_then(|value| value.get("chapters")).and_then(Value::as_array);
    for (index, chapter) in chapters.into_iter().flatten().enumerate() {
        let title = chapter.get("title").and_then(Value::as_str).unwrap_or("未命名章节").trim().to_string();
        let key = chapter.get("id").map(Value::to_string).unwrap_or_else(|| format!("title:{title}:{index}"));
        let content = chapter.get("content").and_then(Value::as_str).unwrap_or_default().to_string();
        result.insert(key, (title, content));
    }
    result
}

fn limited_titles(items: &[String], limit: usize) -> Vec<String> {
    let mut result = items.iter().take(limit).map(|item| text_excerpt(item, 80)).collect::<Vec<_>>();
    if items.len() > limit { result.push(format!("等 {} 章", items.len())); }
    result
}

pub(crate) fn github_backup_changes(previous: Option<&Value>, current: &Value, staged_files: &str) -> Value {
    let previous_chapters = project_chapter_map(previous);
    let current_chapters = project_chapter_map(Some(current));
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();
    let mut details = Vec::new();

    for (key, (title, content)) in &current_chapters {
        match previous_chapters.get(key) {
            None => {
                added.push(title.clone());
                if details.len() < 16 { details.push(serde_json::json!({ "status": "新增", "title": title, "afterWords": content.chars().filter(|value| !value.is_whitespace()).count(), "afterExcerpt": text_excerpt(content, 480) })); }
            }
            Some((old_title, old_content)) if old_title != title || old_content != content => {
                modified.push(title.clone());
                if details.len() < 16 { details.push(serde_json::json!({ "status": "修改", "title": title, "beforeWords": old_content.chars().filter(|value| !value.is_whitespace()).count(), "afterWords": content.chars().filter(|value| !value.is_whitespace()).count(), "beforeExcerpt": text_excerpt(old_content, 480), "afterExcerpt": text_excerpt(content, 480) })); }
            }
            _ => {}
        }
    }
    for (key, (title, content)) in &previous_chapters {
        if !current_chapters.contains_key(key) {
            deleted.push(title.clone());
            if details.len() < 16 { details.push(serde_json::json!({ "status": "删除", "title": title, "beforeWords": content.chars().filter(|value| !value.is_whitespace()).count(), "beforeExcerpt": text_excerpt(content, 480) })); }
        }
    }

    let metadata_fields = ["title", "synopsis", "genre", "subgenre", "protagonist1", "protagonist2", "status", "chapterTargetWords", "authorPreferences"];
    let metadata = metadata_fields.iter().filter(|field| previous.and_then(|value| value.get(**field)) != current.get(**field)).map(|field| (*field).to_string()).collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut outlines = 0_u64;
    let mut cards = 0_u64;
    let mut memories = 0_u64;
    let mut graph = 0_u64;
    for line in staged_files.lines().filter(|line| !line.trim().is_empty()) {
        let path = line.split('\t').next_back().unwrap_or(line).trim().replace('\\', "/");
        if path.starts_with("大纲/") { outlines += 1; }
        else if path.starts_with("卡片/") { cards += 1; }
        else if path.starts_with("记忆/") { memories += 1; }
        else if path.starts_with("图谱/") { graph += 1; }
        if files.len() < 100 { files.push(path); }
    }

    serde_json::json!({
        "addedChapterCount": added.len(), "addedChapters": limited_titles(&added, 40),
        "modifiedChapterCount": modified.len(), "modifiedChapters": limited_titles(&modified, 40),
        "deletedChapterCount": deleted.len(), "deletedChapters": limited_titles(&deleted, 40),
        "chapterDetails": details,
        "metadataFields": metadata,
        "otherFiles": { "outlines": outlines, "cards": cards, "memories": memories, "graph": graph },
        "changedFiles": files,
    })
}

fn joined_titles(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("、")).unwrap_or_default()
}

pub(crate) fn github_fallback_commit(project_title: &str, changes: &Value) -> (String, String) {
    let added = changes.get("addedChapterCount").and_then(Value::as_u64).unwrap_or(0);
    let modified = changes.get("modifiedChapterCount").and_then(Value::as_u64).unwrap_or(0);
    let deleted = changes.get("deletedChapterCount").and_then(Value::as_u64).unwrap_or(0);
    let title = if added > 0 { format!("新增 {added} 章并更新《{project_title}》") }
        else if modified > 0 { format!("修订 {modified} 章《{project_title}》正文") }
        else if deleted > 0 { format!("删除 {deleted} 章并更新《{project_title}》") }
        else { format!("更新《{project_title}》创作资料") };
    let mut lines = Vec::new();
    for (label, field) in [("新增章节", "addedChapters"), ("修改章节", "modifiedChapters"), ("删除章节", "deletedChapters")] {
        let names = joined_titles(changes, field);
        if !names.is_empty() { lines.push(format!("{label}：{names}")); }
    }
    let other = changes.get("otherFiles").and_then(Value::as_object);
    let summaries = [("大纲", "outlines"), ("卡片", "cards"), ("记忆", "memories"), ("图谱", "graph")].iter().filter_map(|(label, key)| {
        let count = other.and_then(|value| value.get(*key)).and_then(Value::as_u64).unwrap_or(0);
        (count > 0).then(|| format!("{label} {count} 项"))
    }).collect::<Vec<_>>();
    if !summaries.is_empty() { lines.push(format!("其他资料：{}", summaries.join("、"))); }
    let metadata = joined_titles(changes, "metadataFields");
    if !metadata.is_empty() { lines.push(format!("项目信息：{metadata}")); }
    if lines.is_empty() { lines.push("创作资料文件已更新".to_string()); }
    (title.chars().take(60).collect(), lines.join("\n"))
}

fn write_github_project_snapshot(app: &tauri::AppHandle, checkout: &Path, project: Value) -> Result<(String, Value, bool), String> {
    let project_id = project.get("id").and_then(Value::as_i64).filter(|id| *id > 0).ok_or_else(|| "小说缺少有效 ID".to_string())?;
    let project_title = project.get("title").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if project_title.is_empty() { return Err("小说名称不能为空".to_string()); }
    let previous = read_github_project(checkout).ok();
    let source = find_project_directory(app, project_id)?;
    for managed in GITHUB_MANAGED_PATHS {
        let path = checkout.join(managed);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() || metadata.is_file() { fs::remove_file(&path).map_err(|error| format!("清理仓库旧小说文件失败: {error}"))?; }
            else if metadata.is_dir() { fs::remove_dir_all(&path).map_err(|error| format!("清理仓库旧小说目录失败: {error}"))?; }
        }
    }
    copy_cloud_backup_contents(&source, checkout)?;
    let mut project_snapshot = project;
    if let Some(object) = project_snapshot.as_object_mut() {
        object.remove("publishConfig");
        object.remove("publishRecords");
        object.remove("githubRepositoryUrl");
    }
    let metadata_path = checkout.join("metadata.json");
    if let Ok(content) = fs::read_to_string(&metadata_path) {
        if let Ok(mut metadata) = serde_json::from_str::<Value>(&content) {
            if let Some(object) = metadata.as_object_mut() {
                object.remove("publishConfig");
                object.remove("publishRecords");
                object.remove("githubRepositoryUrl");
            }
            fs::write(&metadata_path, serde_json::to_vec_pretty(&metadata).map_err(|error| format!("序列化 GitHub 小说索引失败: {error}"))?).map_err(|error| format!("写入 GitHub 小说索引失败: {error}"))?;
        }
    }
    fs::write(checkout.join(GITHUB_PROJECT_DATA), serde_json::to_vec_pretty(&project_snapshot).map_err(|error| format!("序列化 GitHub 小说备份失败: {error}"))?).map_err(|error| format!("写入 GitHub 小说备份失败: {error}"))?;
    let marker = serde_json::json!({ "kind": GITHUB_PROJECT_KIND, "schemaVersion": 1, "projectId": project_id, "title": &project_title });
    fs::write(checkout.join(GITHUB_PROJECT_MARKER), serde_json::to_vec_pretty(&marker).map_err(|error| format!("序列化 GitHub 备份标记失败: {error}"))?).map_err(|error| format!("写入 GitHub 备份标记失败: {error}"))?;
    run_git(&["add", "--all"], Some(checkout))?;
    let status = run_git(&["-c", "core.quotepath=false", "diff", "--cached", "--name-status"], Some(checkout))?;
    let changes = github_backup_changes(previous.as_ref(), &project_snapshot, &status);
    Ok((project_title, changes, !status.trim().is_empty()))
}

fn sanitize_commit_title(value: &str, fallback: &str) -> String {
    let title = value.replace(['\r', '\n', '\0'], " ").trim().chars().take(60).collect::<String>();
    if title.is_empty() { fallback.to_string() } else { title }
}

#[tauri::command]
pub async fn backup_project_to_github(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    repository_url: String,
    project: Value,
    agent_params: Value,
) -> Result<Value, String> {
    let repository_url = validate_github_repository_url(&repository_url)?;
    let project_id = project.get("id").and_then(Value::as_i64).filter(|id| *id > 0).ok_or_else(|| "小说缺少有效 ID".to_string())?;
    let initial_title = project.get("title").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let prepare_app = app.clone();
    let prepare_url = repository_url.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let _ = prepare_app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-backup", "stage": "clone", "message": "正在拉取 GitHub 仓库并计算真实差异..." }));
        let app_data = app_data_directory(&prepare_app)?;
        let checkout = clone_github_repository(&app_data, &prepare_url, ".github-backup")?;
        validate_github_backup_destination(&checkout, project_id, &initial_title)?;
        let (project_title, changes, changed) = write_github_project_snapshot(&prepare_app, &checkout, project)?;
        // 首次备份到空仓库时尚未产生 HEAD，只有“无变更”分支才需要提前读取当前提交
        let (branch, commit) = if changed {
            (String::new(), String::new())
        } else {
            (run_git(&["branch", "--show-current"], Some(&checkout))?, run_git(&["rev-parse", "--short", "HEAD"], Some(&checkout))?)
        };
        Ok::<_, String>((app_data, checkout, project_title, changes, changed, branch, commit))
    }).await.map_err(|error| format!("GitHub 备份准备任务中断: {error}"))??;

    let (app_data, checkout, project_title, changes, changed, branch, commit) = prepared;
    if !changed {
        fs::remove_dir_all(app_data.join(".github-backup")).ok();
        return Ok(serde_json::json!({ "repositoryUrl": repository_url, "title": project_title, "branch": branch, "commit": commit, "changed": false, "changes": changes }));
    }

    let (fallback_title, fallback_body) = github_fallback_commit(&project_title, &changes);
    let mut ai_title = fallback_title.clone();
    let mut ai_body = fallback_body.replace('\0', "");
    if agent_params.get("apiKey").and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty()) {
        let _ = app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-backup", "stage": "summarize", "message": "正在让 AI 整理本次备份的提交说明..." }));
        let mut params = agent_params.as_object().cloned().unwrap_or_default();
        params.insert("projectTitle".to_string(), Value::String(project_title.clone()));
        params.insert("changes".to_string(), changes.clone());
        params.insert("fallbackTitle".to_string(), Value::String(fallback_title.clone()));
        params.insert("fallbackBody".to_string(), Value::String(fallback_body.clone()));
        if let Ok(result) = call_agent_rpc(app.clone(), state, "github.commit.describe".to_string(), Value::Object(params)).await {
            ai_title = result.get("title").and_then(Value::as_str).map(|value| sanitize_commit_title(value, &fallback_title)).unwrap_or_else(|| fallback_title.clone());
            ai_body = result.get("body").and_then(Value::as_str).unwrap_or(&fallback_body).replace('\0', "").chars().take(1200).collect();
        }
    }

    let commit_app = app.clone();
    let commit_url = repository_url.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_git_identity(&checkout)?;
        let _ = commit_app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-backup", "stage": "commit", "message": format!("正在提交：{ai_title}") }));
        let details_body = fallback_body.replace('\0', "");
        run_git(&["commit", "-m", &ai_title, "-m", &ai_body, "-m", &details_body], Some(&checkout))?;
        let _ = commit_app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-backup", "stage": "push", "message": "正在推送到 GitHub..." }));
        run_git(&["push", "--set-upstream", "origin", "HEAD"], Some(&checkout))?;
        let branch = run_git(&["branch", "--show-current"], Some(&checkout))?;
        let commit = run_git(&["rev-parse", "--short", "HEAD"], Some(&checkout))?;
        fs::remove_dir_all(app_data.join(".github-backup")).ok();
        let _ = commit_app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-backup", "stage": "done", "message": "小说已推送到 GitHub。" }));
        Ok::<_, String>(serde_json::json!({ "repositoryUrl": commit_url, "title": project_title, "branch": branch, "commit": commit, "changed": true, "commitTitle": ai_title, "changes": changes }))
    }).await.map_err(|error| format!("GitHub 提交任务中断: {error}"))?
}

#[cfg(test)]
mod change_tests {
    use super::*;

    #[test]
    fn chapter_diff_and_fallback_commit_are_readable() {
        let previous = serde_json::json!({ "chapters": [{ "id": 1, "title": "第一章", "content": "旧正文" }, { "id": 2, "title": "第二章", "content": "将删除" }] });
        let current = serde_json::json!({ "chapters": [{ "id": 1, "title": "第一章", "content": "新正文" }, { "id": 3, "title": "第三章", "content": "新增正文" }] });
        let changes = github_backup_changes(Some(&previous), &current, "M\t章节/第一章.md\nA\t章节/第三章.md\nD\t章节/第二章.md\nM\t大纲/总纲.md");
        assert_eq!(changes["addedChapterCount"], 1);
        assert_eq!(changes["modifiedChapterCount"], 1);
        assert_eq!(changes["deletedChapterCount"], 1);
        let (title, body) = github_fallback_commit("测试小说", &changes);
        assert!(title.contains("新增 1 章"));
        assert!(body.contains("修改章节：第一章"));
        assert!(body.contains("删除章节：第二章"));
    }
}

#[tauri::command]
pub async fn load_project_from_github(app: tauri::AppHandle, repository_url: String) -> Result<Value, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || load_project_from_github_blocking(handle, repository_url))
        .await
        .map_err(|error| format!("GitHub 恢复任务中断: {error}"))?
}

fn load_project_from_github_blocking(app: tauri::AppHandle, repository_url: String) -> Result<Value, String> {
    let repository_url = validate_github_repository_url(&repository_url)?;
    let _ = app.emit("cloud-sync-progress", serde_json::json!({ "action": "github-restore", "stage": "clone", "message": "正在从 GitHub 拉取小说..." }));
    let app_data = app_data_directory(&app)?;
    let checkout = clone_github_repository(&app_data, &repository_url, ".github-restore")?;
    let project = read_github_project(&checkout)?;
    let branch = run_git(&["branch", "--show-current"], Some(&checkout))?;
    let commit = run_git(&["rev-parse", "--short", "HEAD"], Some(&checkout))?;
    fs::remove_dir_all(app_data.join(".github-restore")).ok();
    Ok(serde_json::json!({ "repositoryUrl": repository_url, "branch": branch, "commit": commit, "project": project }))
}
