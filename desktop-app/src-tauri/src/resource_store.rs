use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use super::project_store::{app_data_directory, safe_file_name, safe_folder_name};

pub fn dismantle_chapter_stem(chapter: &Value, index: usize) -> String {
    let number = chapter.get("number").and_then(Value::as_u64).unwrap_or((index + 1) as u64);
    let title = chapter.get("title").and_then(Value::as_str).unwrap_or("未命名章节");
    format!("{number:03}-{}", safe_file_name(title))
}

#[tauri::command]
pub fn load_dismantle_books(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let root = app_data_directory(&app)?.join("dismantles");
    if !root.exists() {
        return Ok(None);
    }
    let mut books = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&root)
        .map_err(|error| format!("读取拆书目录失败: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let directory = entry.path();
        let metadata_path = directory.join("metadata.json");
        if !metadata_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&metadata_path)
            .map_err(|error| format!("读取拆书元数据失败: {error}"))?;
        let mut book: Value = serde_json::from_str(&content)
            .map_err(|error| format!("拆书元数据格式错误: {error}"))?;
        if let Some(chapters) = book.get_mut("chapters").and_then(Value::as_array_mut) {
            for (index, chapter) in chapters.iter_mut().enumerate() {
                let stem = dismantle_chapter_stem(chapter, index);
                let source_path = chapter.get("sourcePath").and_then(Value::as_str)
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("原文").join(format!("{stem}.txt")));
                let outline_path = chapter.get("outlinePath").and_then(Value::as_str)
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("章纲").join(format!("{stem}.md")));
                let rewrite_path = chapter.get("rewritePath").and_then(Value::as_str)
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("原创改写").join(format!("{stem}.md")));
                if let Ok(source) = fs::read_to_string(directory.join(&source_path)) {
                    chapter["sourceContent"] = Value::String(source);
                }
                if let Ok(outline) = fs::read_to_string(directory.join(&outline_path)) {
                    chapter["detailedOutline"] = Value::String(outline);
                }
                if let Ok(rewrite) = fs::read_to_string(directory.join(&rewrite_path)) {
                    chapter["rewriteContent"] = Value::String(rewrite);
                }
                chapter["sourcePath"] = Value::String(source_path.to_string_lossy().into_owned());
                chapter["outlinePath"] = Value::String(outline_path.to_string_lossy().into_owned());
                chapter["rewritePath"] = Value::String(rewrite_path.to_string_lossy().into_owned());
            }
        }
        books.push(book);
    }
    Ok(Some(Value::Array(books)))
}

#[tauri::command]
pub fn save_dismantle_books(app: tauri::AppHandle, books: Value) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("dismantles");
    fs::create_dir_all(&root).map_err(|error| format!("创建拆书目录失败: {error}"))?;
    let books = books.as_array().ok_or_else(|| "拆书数据必须是数组".to_string())?;
    let mut used_directory_names = HashSet::new();
    let mut current_directory_names = HashSet::new();

    for book in books {
        let id = book.get("id").and_then(Value::as_str).unwrap_or("book");
        let title = book.get("title").and_then(Value::as_str).unwrap_or("未命名拆书");
        let mut name = safe_folder_name(title);
        if !used_directory_names.insert(name.clone()) {
            name = format!("{name}-{id}");
            used_directory_names.insert(name.clone());
        }
        current_directory_names.insert(name.clone());
        let directory = root.join(name);
        let source_dir = directory.join("原文");
        let outline_dir = directory.join("章纲");
        let rewrite_dir = directory.join("原创改写");
        fs::create_dir_all(&source_dir).map_err(|error| format!("创建拆书原文目录失败: {error}"))?;
        fs::create_dir_all(&outline_dir).map_err(|error| format!("创建拆书章纲目录失败: {error}"))?;
        fs::create_dir_all(&rewrite_dir).map_err(|error| format!("创建原创改写目录失败: {error}"))?;

        let mut metadata = book.clone();
        if let Some(chapters) = metadata.get_mut("chapters").and_then(Value::as_array_mut) {
            for (index, chapter) in chapters.iter_mut().enumerate() {
                let stem = dismantle_chapter_stem(chapter, index);
                let source = chapter.get("sourceContent").and_then(Value::as_str).unwrap_or("");
                let outline = chapter.get("detailedOutline").and_then(Value::as_str).unwrap_or("");
                let rewrite = chapter.get("rewriteContent").and_then(Value::as_str).unwrap_or("");
                let source_path = PathBuf::from("原文").join(format!("{stem}.txt"));
                let outline_path = PathBuf::from("章纲").join(format!("{stem}.md"));
                let rewrite_path = PathBuf::from("原创改写").join(format!("{stem}.md"));
                fs::write(directory.join(&source_path), source)
                    .map_err(|error| format!("保存拆书原文失败: {error}"))?;
                if !outline.trim().is_empty() {
                    fs::write(directory.join(&outline_path), outline)
                        .map_err(|error| format!("保存拆书章纲失败: {error}"))?;
                }
                if !rewrite.trim().is_empty() {
                    fs::write(directory.join(&rewrite_path), rewrite)
                        .map_err(|error| format!("保存原创改写稿失败: {error}"))?;
                }
                chapter["sourcePath"] = Value::String(source_path.to_string_lossy().into_owned());
                chapter["outlinePath"] = Value::String(outline_path.to_string_lossy().into_owned());
                chapter["rewritePath"] = Value::String(rewrite_path.to_string_lossy().into_owned());
                chapter["sourceContent"] = Value::String(String::new());
                chapter["detailedOutline"] = Value::String(String::new());
                chapter["rewriteContent"] = Value::String(String::new());
            }
        }
        fs::write(
            directory.join("metadata.json"),
            serde_json::to_vec_pretty(&metadata).map_err(|error| format!("序列化拆书元数据失败: {error}"))?,
        ).map_err(|error| format!("保存拆书元数据失败: {error}"))?;
    }
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.filter_map(Result::ok).filter(|entry| entry.path().is_dir()) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !current_directory_names.contains(&name) {
                fs::remove_dir_all(entry.path()).map_err(|error| format!("清理已删除拆书失败: {error}"))?;
            }
        }
    }
    Ok(root.to_string_lossy().into_owned())
}

pub fn library_chapter_stem(chapter: &Value, index: usize) -> String {
    let number = chapter.get("number").and_then(Value::as_u64).unwrap_or((index + 1) as u64);
    let title = chapter.get("title").and_then(Value::as_str).unwrap_or("未命名章节");
    format!("{number:03}-{}", safe_file_name(title))
}

#[tauri::command]
pub fn load_library_books(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let root = app_data_directory(&app)?.join("books");
    if !root.exists() { return Ok(None); }
    let mut books = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&root).map_err(|error| format!("读取书籍目录失败: {error}"))?
        .filter_map(Result::ok).filter(|entry| entry.path().is_dir()).collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let directory = entry.path();
        let metadata_path = directory.join("metadata.json");
        if !metadata_path.exists() { continue; }
        let content = fs::read_to_string(&metadata_path).map_err(|error| format!("读取书籍元数据失败: {error}"))?;
        let mut book: Value = serde_json::from_str(&content).map_err(|error| format!("书籍元数据格式错误: {error}"))?;
        if let Some(chapters) = book.get_mut("chapters").and_then(Value::as_array_mut) {
            for (index, chapter) in chapters.iter_mut().enumerate() {
                let relative = chapter.get("sourcePath").and_then(Value::as_str).map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("章节").join(format!("{}.md", library_chapter_stem(chapter, index))));
                if let Ok(text) = fs::read_to_string(directory.join(&relative)) {
                    let has_content = !text.trim().is_empty();
                    let was_downloaded = chapter.get("downloaded").and_then(Value::as_bool).unwrap_or(has_content);
                    let incomplete = chapter.get("unavailableReason").and_then(Value::as_str).is_some_and(|reason| !reason.trim().is_empty());
                    chapter["content"] = Value::String(text);
                    chapter["downloaded"] = Value::Bool(has_content && was_downloaded && !incomplete);
                }
                chapter["sourcePath"] = Value::String(relative.to_string_lossy().into_owned());
            }
        }
        book["localPath"] = Value::String(directory.to_string_lossy().into_owned());
        books.push(book);
    }
    Ok(Some(Value::Array(books)))
}

#[tauri::command]
pub fn save_library_books(app: tauri::AppHandle, books: Value) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("books");
    fs::create_dir_all(&root).map_err(|error| format!("创建书籍目录失败: {error}"))?;
    let books = books.as_array().ok_or_else(|| "书籍数据必须是数组".to_string())?;
    let mut active = HashSet::new();
    for book in books {
        let id = book.get("id").and_then(Value::as_str).unwrap_or("book");
        let title = book.get("title").and_then(Value::as_str).unwrap_or("未命名书籍");
        let directory = root.join(format!("{}-{}", safe_folder_name(title), safe_file_name(id)));
        active.insert(directory.file_name().unwrap_or_default().to_string_lossy().into_owned());
        let chapter_dir = directory.join("章节");
        fs::create_dir_all(&chapter_dir).map_err(|error| format!("创建书籍章节目录失败: {error}"))?;
        let mut metadata = book.clone();
        if let Some(chapters) = metadata.get_mut("chapters").and_then(Value::as_array_mut) {
            let mut combined = String::new();
            for (index, chapter) in chapters.iter_mut().enumerate() {
                let relative = PathBuf::from("章节").join(format!("{}.md", library_chapter_stem(chapter, index)));
                let content = chapter.get("content").and_then(Value::as_str).unwrap_or("");
                fs::write(directory.join(&relative), content).map_err(|error| format!("保存书籍章节失败: {error}"))?;
                if !content.trim().is_empty() {
                    if !combined.is_empty() { combined.push_str("\n\n"); }
                    combined.push_str(chapter.get("title").and_then(Value::as_str).unwrap_or("未命名章节"));
                    combined.push('\n');
                    combined.push_str(content);
                }
                chapter["sourcePath"] = Value::String(relative.to_string_lossy().into_owned());
                chapter["content"] = Value::String(String::new());
            }
            fs::write(directory.join(format!("{}.txt", safe_file_name(title))), combined)
                .map_err(|error| format!("保存书籍 TXT 失败: {error}"))?;
        }
        metadata["localPath"] = Value::String(directory.to_string_lossy().into_owned());
        fs::write(directory.join("metadata.json"), serde_json::to_vec_pretty(&metadata).map_err(|error| format!("序列化书籍元数据失败: {error}"))?)
            .map_err(|error| format!("保存书籍元数据失败: {error}"))?;
    }
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.filter_map(Result::ok).filter(|entry| entry.path().is_dir()) {
            if !active.contains(&entry.file_name().to_string_lossy().into_owned()) {
                fs::remove_dir_all(entry.path()).map_err(|error| format!("清理已删除书籍失败: {error}"))?;
            }
        }
    }
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn delete_library_book(app: tauri::AppHandle, book_id: String, book_title: String) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("books");
    if !root.exists() { return Ok(root.to_string_lossy().into_owned()); }
    let preferred = root.join(format!("{}-{}", safe_folder_name(&book_title), safe_file_name(&book_id)));
    let directory = if preferred.exists() { Some(preferred) } else {
        fs::read_dir(&root).ok().and_then(|entries| entries.filter_map(Result::ok).find(|entry| {
            if !entry.path().is_dir() { return false; }
            let metadata = fs::read_to_string(entry.path().join("metadata.json")).ok();
            metadata.and_then(|content| serde_json::from_str::<Value>(&content).ok())
                .and_then(|value| value.get("id").and_then(Value::as_str).map(|id| id == book_id))
                .unwrap_or(false)
        }).map(|entry| entry.path()))
    };
    if let Some(directory) = directory {
        fs::remove_dir_all(&directory).map_err(|error| format!("删除书籍目录失败: {error}"))?;
        return Ok(directory.to_string_lossy().into_owned());
    }
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn load_ranking_books(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = app_data_directory(&app)?.join("rankings").join("metadata.json");
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(path).map_err(|error| format!("读取榜单缓存失败: {error}"))?;
    serde_json::from_str(&content).map(Some).map_err(|error| format!("榜单缓存格式错误: {error}"))
}

#[tauri::command]
pub fn save_ranking_books(app: tauri::AppHandle, books: Value) -> Result<String, String> {
    let directory = app_data_directory(&app)?.join("rankings");
    fs::create_dir_all(&directory).map_err(|error| format!("创建榜单目录失败: {error}"))?;
    fs::write(directory.join("metadata.json"), serde_json::to_vec_pretty(&books).map_err(|error| format!("序列化榜单缓存失败: {error}"))?)
        .map_err(|error| format!("保存榜单缓存失败: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_library_book_location(app: tauri::AppHandle, book_id: String, book_title: String) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("books");
    let preferred = root.join(format!("{}-{}", safe_folder_name(&book_title), safe_file_name(&book_id)));
    let directory = if preferred.exists() { preferred } else {
        fs::read_dir(&root).ok().and_then(|entries| entries.filter_map(Result::ok).find(|entry| entry.path().is_dir() && entry.file_name().to_string_lossy().contains(&safe_file_name(&book_id))).map(|entry| entry.path())).unwrap_or(preferred)
    };
    if !directory.exists() { return Err("书籍尚未保存到本地".to_string()); }
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&directory).status().map_err(|error| format!("打开书籍位置失败: {error}"))?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&directory).status().map_err(|error| format!("打开书籍位置失败: {error}"))?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&directory).status().map_err(|error| format!("打开书籍位置失败: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn load_writing_styles(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let directory = app_data_directory(&app)?.join("styles");
    let metadata_path = directory.join("metadata.json");
    if !metadata_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&metadata_path).map_err(|error| format!("读取文风索引失败: {error}"))?;
    let mut styles: Value = serde_json::from_str(&content).map_err(|error| format!("文风索引格式错误: {error}"))?;
    if let Some(items) = styles.as_array_mut() {
        for style in items {
            let source_path = style.get("sourcePath").and_then(Value::as_str)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(format!("{}.md", safe_file_name(style.get("name").and_then(Value::as_str).unwrap_or("未命名文风")))));
            if let Ok(markdown) = fs::read_to_string(directory.join(&source_path)) {
                style["content"] = Value::String(markdown);
            }
            style["sourcePath"] = Value::String(source_path.to_string_lossy().into_owned());
        }
    }
    Ok(Some(styles))
}

#[tauri::command]
pub fn save_writing_styles(app: tauri::AppHandle, styles: Value) -> Result<String, String> {
    let directory = app_data_directory(&app)?.join("styles");
    fs::create_dir_all(&directory).map_err(|error| format!("创建文风目录失败: {error}"))?;
    let styles = styles.as_array().ok_or_else(|| "文风数据必须是数组".to_string())?;
    let mut metadata = styles.clone();
    let mut current_files = HashSet::from(["metadata.json".to_string()]);
    for style in metadata.iter_mut() {
        let id = style.get("id").and_then(Value::as_str).unwrap_or("style");
        let name = style.get("name").and_then(Value::as_str).unwrap_or("未命名文风");
        let content = style.get("content").and_then(Value::as_str).unwrap_or("");
        let source_path = PathBuf::from(format!("{}-{}.md", safe_file_name(name), safe_file_name(id)));
        current_files.insert(source_path.to_string_lossy().into_owned());
        fs::write(directory.join(&source_path), content).map_err(|error| format!("保存文风 Markdown 失败: {error}"))?;
        style["sourcePath"] = Value::String(source_path.to_string_lossy().into_owned());
        style["content"] = Value::String(String::new());
    }
    fs::write(
        directory.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).map_err(|error| format!("序列化文风索引失败: {error}"))?,
    ).map_err(|error| format!("保存文风索引失败: {error}"))?;
    if let Ok(entries) = fs::read_dir(&directory) {
        for entry in entries.filter_map(Result::ok).filter(|entry| entry.path().is_file()) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !current_files.contains(&name) {
                fs::remove_file(entry.path()).map_err(|error| format!("清理已删除文风失败: {error}"))?;
            }
        }
    }
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_dismantle_location(app: tauri::AppHandle, book_title: String) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("dismantles");
    let mut directory = root.join(safe_folder_name(&book_title));
    if !directory.exists() {
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.filter_map(Result::ok).filter(|entry| entry.path().is_dir()) {
                let metadata_path = entry.path().join("metadata.json");
                let matches = fs::read_to_string(metadata_path).ok()
                    .and_then(|content| serde_json::from_str::<Value>(&content).ok())
                    .and_then(|value| value.get("title").and_then(Value::as_str).map(|title| title == book_title))
                    .unwrap_or(false);
                if matches {
                    directory = entry.path();
                    break;
                }
            }
        }
    }
    if !directory.exists() {
        return Err("拆书资料尚未保存，请稍后再试".to_string());
    }
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&directory).status().map_err(|error| format!("打开拆书位置失败: {error}"))?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&directory).status().map_err(|error| format!("打开拆书位置失败: {error}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open").arg(&directory).status().map_err(|error| format!("打开拆书位置失败: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn delete_dismantle_book(app: tauri::AppHandle, book_id: String, book_title: String) -> Result<String, String> {
    let root = app_data_directory(&app)?.join("dismantles");
    if !root.exists() { return Ok(root.to_string_lossy().into_owned()); }
    let mut directory = None;
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.filter_map(Result::ok).filter(|entry| entry.path().is_dir()) {
            let metadata = fs::read_to_string(entry.path().join("metadata.json")).ok();
            let matches = metadata.and_then(|content| serde_json::from_str::<Value>(&content).ok())
                .map(|value| {
                    value.get("id").and_then(Value::as_str).map(|id| id == book_id).unwrap_or(false)
                        || value.get("title").and_then(Value::as_str).map(|title| title == book_title).unwrap_or(false)
                }).unwrap_or(false);
            if matches {
                directory = Some(entry.path());
                break;
            }
        }
    }
    if let Some(directory) = directory {
        fs::remove_dir_all(&directory).map_err(|error| format!("删除拆书目录失败: {error}"))?;
        return Ok(directory.to_string_lossy().into_owned());
    }
    Ok(root.to_string_lossy().into_owned())
}
