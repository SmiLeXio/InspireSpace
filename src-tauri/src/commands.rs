use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use tauri::{State, WebviewWindow};

use crate::workspace::{CanvasNode, MediaAsset, Viewport, WorkspaceService, WorkspaceSnapshot};

pub struct AppState {
    pub workspaces: Mutex<HashMap<String, WorkspaceService>>,
}

fn window_label(window: &WebviewWindow) -> String {
    window.label().to_string()
}

fn lock_workspaces<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, HashMap<String, WorkspaceService>>, String> {
    state
        .workspaces
        .lock()
        .map_err(|_| "项目状态锁已损坏，请重启 InspireSpace".to_string())
}

fn insert_workspace(
    state: &State<'_, AppState>,
    window: &WebviewWindow,
    service: WorkspaceService,
) -> Result<WorkspaceSnapshot, String> {
    let snapshot = service.snapshot().map_err(|error| error.to_string())?;
    lock_workspaces(state)?.insert(window_label(window), service);
    Ok(snapshot)
}

fn validate_project_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.contains("..")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed
            .chars()
            .any(|character| matches!(character, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err("项目名称包含不允许的字符".to_string());
    }
    Ok(trimmed)
}

fn workspace_path(parent_path: &str, name: &str) -> Result<PathBuf, String> {
    let name = validate_project_name(name)?;
    let parent = Path::new(parent_path.trim());
    if parent_path.trim().is_empty() || !parent.is_dir() {
        return Err("请选择有效的父文件夹".to_string());
    }
    Ok(parent.join(name))
}

fn with_workspace<T>(
    state: State<'_, AppState>,
    window: WebviewWindow,
    operation: impl FnOnce(&WorkspaceService) -> anyhow::Result<T>,
) -> Result<T, String> {
    let workspaces = lock_workspaces(&state)?;
    let workspace = workspaces
        .get(window.label())
        .ok_or_else(|| "当前窗口尚未打开项目，请先返回欢迎页选择项目".to_string())?;
    operation(workspace).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_workspace(
    state: State<'_, AppState>,
    window: WebviewWindow,
    path: String,
) -> Result<WorkspaceSnapshot, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("所选项目文件夹不存在".to_string());
    }
    let service = WorkspaceService::open(root).map_err(|error| error.to_string())?;
    insert_workspace(&state, &window, service)
}

#[tauri::command]
pub fn create_workspace(
    state: State<'_, AppState>,
    window: WebviewWindow,
    parent_path: String,
    name: String,
) -> Result<WorkspaceSnapshot, String> {
    let target = workspace_path(&parent_path, &name)?;
    if target.exists() {
        return Err("同名项目已存在，请换一个名称".to_string());
    }
    let service = WorkspaceService::open(target).map_err(|error| error.to_string())?;
    insert_workspace(&state, &window, service)
}

#[tauri::command]
pub fn open_default_workspace(
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> Result<WorkspaceSnapshot, String> {
    let service = WorkspaceService::new_default().map_err(|error| error.to_string())?;
    insert_workspace(&state, &window, service)
}

#[tauri::command]
pub fn clone_repository(
    state: State<'_, AppState>,
    window: WebviewWindow,
    url: String,
    parent_path: String,
    name: String,
) -> Result<WorkspaceSnapshot, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Git 仓库地址不能为空".to_string());
    }
    let target = workspace_path(&parent_path, &name)?;
    if target.exists() {
        return Err("目标文件夹已存在，请换一个项目名称".to_string());
    }

    let output = Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(url)
        .arg(&target)
        .output()
        .map_err(|error| format!("无法启动 Git：{error}"))?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if details.is_empty() {
            "克隆 Git 仓库失败".to_string()
        } else {
            format!("克隆 Git 仓库失败：{details}")
        });
    }

    let service = WorkspaceService::open(target).map_err(|error| error.to_string())?;
    insert_workspace(&state, &window, service)
}

#[tauri::command]
pub fn load_workspace(
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> Result<WorkspaceSnapshot, String> {
    with_workspace(state, window, WorkspaceService::snapshot)
}

#[tauri::command]
pub fn upsert_node(
    state: State<'_, AppState>,
    window: WebviewWindow,
    node: CanvasNode,
) -> Result<(), String> {
    with_workspace(state, window, |workspace| workspace.upsert_node(&node))
}

#[tauri::command]
pub fn delete_node(
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    with_workspace(state, window, |workspace| workspace.delete_node(&id))
}

#[tauri::command]
pub fn save_text_content(
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: String,
    content: String,
) -> Result<String, String> {
    with_workspace(state, window, |workspace| {
        workspace.save_text(&id, &content)
    })
}

#[tauri::command]
pub fn save_viewport(
    state: State<'_, AppState>,
    window: WebviewWindow,
    viewport: Viewport,
) -> Result<(), String> {
    with_workspace(state, window, |workspace| {
        workspace.save_viewport(&viewport)
    })
}

#[tauri::command]
pub fn import_media(
    state: State<'_, AppState>,
    window: WebviewWindow,
    source_path: String,
    kind: String,
) -> Result<MediaAsset, String> {
    with_workspace(state, window, |workspace| {
        workspace.import_media(&source_path, &kind)
    })
}
