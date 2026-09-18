use serde_json::Value;
use tauri::{Manager, State};

use crate::sidecar::SidecarState;

/// The UI calls this once the React app has mounted and the engine answered
/// engine.ping: the splash has done its job, so swap it for the main window.
#[tauri::command]
pub fn startup_complete(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(splash) = app.get_webview_window("splash") {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

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

// Named presets keep the common pickers readable; any other value is treated as
// a comma-separated extension list (e.g. "md" or "txt,md,csv"). None means "no
// extension filter", used by the attachment picker which accepts any file type.
fn dialog_extensions(filter: Option<&str>) -> Option<(String, Vec<String>)> {
    let named = |label: &str, exts: &[&str]| {
        Some((
            label.to_string(),
            exts.iter().map(|s| s.to_string()).collect(),
        ))
    };
    match filter {
        Some("any") | Some("all") => None,
        None | Some("") | Some("pdf") => named("PDF Files", &["pdf"]),
        Some("images") => named(
            "Image Files",
            &["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "svg"],
        ),
        Some("office") => named(
            "Office Documents",
            &[
                "docx", "doc", "odt", "rtf", "xlsx", "xls", "ods", "pptx", "ppt", "odp", "odg",
            ],
        ),
        Some("ebook") => named("Ebook Files", &["epub", "fb2"]),
        Some("comic") => named("Comic Archives", &["cbz"]),
        Some(spec) => {
            let exts: Vec<String> = spec
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            Some(("Files".to_string(), exts))
        }
    }
}

#[tauri::command]
pub async fn dialog_open_pdf(
    app: tauri::AppHandle,
    multiple: bool,
    filter: Option<String>,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    // None means the filter accepts any file type (the attachment picker); the
    // builder without add_filter is the OS-native "All files" dialog.
    if let Some((label, extensions)) = dialog_extensions(filter.as_deref()) {
        let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(label, &ext_refs);
    }

    let picked = builder.blocking_pick_files();

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

#[cfg(test)]
mod tests {
    use super::dialog_extensions;

    fn exts(filter: Option<&str>) -> Vec<String> {
        dialog_extensions(filter).expect("filter present").1
    }

    #[test]
    fn office_preset_covers_the_supported_formats() {
        let e = exts(Some("office"));
        for want in [
            "docx", "doc", "odt", "rtf", "xlsx", "xls", "ods", "pptx", "ppt", "odp", "odg",
        ] {
            assert!(e.iter().any(|x| x == want), "missing {want}");
        }
    }

    #[test]
    fn ebook_and_comic_presets_use_their_extensions() {
        assert_eq!(exts(Some("ebook")), vec!["epub", "fb2"]);
        assert_eq!(exts(Some("comic")), vec!["cbz"]);
    }

    #[test]
    fn any_preset_has_no_extension_filter() {
        assert!(dialog_extensions(Some("any")).is_none());
        assert!(dialog_extensions(Some("all")).is_none());
    }

    #[test]
    fn unknown_value_is_a_comma_list() {
        assert_eq!(exts(Some("md,txt")), vec!["md", "txt"]);
    }
}
