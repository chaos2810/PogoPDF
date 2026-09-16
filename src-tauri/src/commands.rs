use serde_json::Value;
use tauri::{Manager, State};

use crate::sidecar::SidecarState;

#[tauri::command]
pub async fn rpc_call(
    state: State<'_, SidecarState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    // Clone the handle under a short read guard, then drop the guard before
    // awaiting: a long job.start must not block job.cancel or app shutdown.
    let engine = state
        .engine
        .read()
        .await
        .clone()
        .ok_or_else(|| "engine not running".to_string())?;
    engine.call(&method, params).await
}

#[tauri::command]
pub async fn dialog_open_pdf(app: tauri::AppHandle, multiple: bool) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .add_filter("PDF Files", &["pdf"])
        .blocking_pick_files();

    let paths: Vec<String> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    // This command calls the dialog plugin directly (not through its JS API),
    // so it skips the plugin's automatic asset-protocol scope registration.
    // Register the picked files here so convertFileSrc can read them.
    let scope = app.asset_protocol_scope();
    for p in &paths {
        let _ = scope.allow_file(p);
    }

    Ok(if multiple {
        paths
    } else {
        paths.into_iter().take(1).collect()
    })
}

#[tauri::command]
pub async fn dialog_save(
    app: tauri::AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("PDF Files", &["pdf"])
        .blocking_save_file();

    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn dialog_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Folders need no asset-protocol scope registration (unlike dialog_open_pdf):
    // nothing renders their contents through convertFileSrc.
    let picked = app.dialog().file().blocking_pick_folder();

    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open explorer: {e}"))
}
