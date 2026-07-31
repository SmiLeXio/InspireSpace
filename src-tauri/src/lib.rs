mod commands;
mod database;
mod workspace;

use commands::{
    clone_repository, create_workspace, delete_node, import_media, load_workspace,
    open_default_workspace, open_workspace, save_text_content, save_viewport, upsert_node,
    AppState,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

static WINDOW_SEQUENCE: AtomicUsize = AtomicUsize::new(1);

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_welcome_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let number = WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let label = format!("workspace-{number}");
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("InspireSpace")
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .decorations(false)
        .resizable(true)
        .center()
        .build()
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 InspireSpace", true, None::<&str>)?;
    let new_window = MenuItem::with_id(app, "new_window", "新建窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_window, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("InspireSpace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "new_window" => {
                if let Ok(window) = create_welcome_window(app) {
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState {
                workspaces: Mutex::new(HashMap::new()),
            });
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            create_workspace,
            open_default_workspace,
            clone_repository,
            load_workspace,
            upsert_node,
            delete_node,
            save_text_content,
            save_viewport,
            import_media
        ])
        .run(tauri::generate_context!())
        .expect("运行 InspireSpace 时发生错误");
}
