#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine_blob;
mod rpc;
mod sidecar;

use std::path::Path;

use tauri::{Emitter, Manager, RunEvent};

use sidecar::SidecarState;

/// Show a native error box before exiting. Release builds run under the
/// `windows` subsystem (no console), so a panic during startup would otherwise
/// leave the user staring at nothing.
#[cfg(windows)]
fn show_fatal_error(msg: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            utype: u32,
        ) -> i32;
    }
    use std::os::windows::ffi::OsStrExt;

    let text: Vec<u16> = std::ffi::OsStr::new(msg).encode_wide().chain([0]).collect();
    let caption: Vec<u16> = std::ffi::OsStr::new("PogoPDF")
        .encode_wide()
        .chain([0])
        .collect();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10); // MB_ICONERROR
    }
}

#[cfg(not(windows))]
fn show_fatal_error(msg: &str) {
    eprintln!("PogoPDF fatal error: {msg}");
}

/// Resolve `(command, working directory)` for the engine sidecar.
///
/// Dev: run the TypeScript entry through `tsx` from the `engine/` package dir
/// so Node resolves the engine's own `node_modules`.
/// Release: extract the embedded engine blob to the per-user cache and run the
/// cached executable (single-file install; no sidecar next to the app).
fn engine_launch_spec() -> Result<(String, String), String> {
    if cfg!(debug_assertions) {
        let engine_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "cannot resolve repository root".to_string())?
            .join("engine");
        let cwd = engine_dir.to_string_lossy().to_string();
        let cmd = std::env::var("POGOPDF_ENGINE_CMD")
            .unwrap_or_else(|_| "node --import tsx src/engine.ts".to_string());
        Ok((cmd, cwd))
    } else {
        let engine_path = engine_blob::ensure_engine_exe()?;
        let cmd = engine_path.to_string_lossy().to_string();
        let cwd = engine_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok((cmd, cwd))
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState {
            engine: tokio::sync::RwLock::new(None),
        })
        .setup(|app| {
            let (cmd, cwd) =
                engine_launch_spec().map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            let handle = app.handle().clone();
            let engine = sidecar::spawn_engine(&cmd, &cwd, move |value| {
                let _ = handle.emit("engine://progress", value);
            })
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            let state = app.state::<SidecarState>();
            *state.engine.blocking_write() = Some(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::rpc_call,
            commands::dialog_open_pdf,
            commands::dialog_save,
            commands::dialog_pick_folder,
            commands::reveal
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<SidecarState>();
                // Short blocking write guard: take the handle out so a running
                // job.start RPC cannot delay window teardown.
                let engine = state.engine.blocking_write().take();
                if let Some(engine) = engine {
                    engine.kill();
                }
            }
        })
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(e) => {
            show_fatal_error(&format!("PogoPDF failed to start:\n\n{e}"));
            std::process::exit(1);
        }
    };

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let state = handle.state::<SidecarState>();
            let engine = state.engine.blocking_write().take();
            if let Some(engine) = engine {
                engine.kill();
            }
        }
    });
}
