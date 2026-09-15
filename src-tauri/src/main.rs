#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod rpc;
mod sidecar;

use std::path::Path;

use tauri::{Emitter, Manager, RunEvent};

use sidecar::SidecarState;

/// Resolve `(command, working directory)` for the engine sidecar.
///
/// Dev: run the TypeScript entry through `tsx` from the `engine/` package dir
/// so Node resolves the engine's own `node_modules`.
/// Release: an `engine.exe` bundled next to the main executable (Task 11).
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
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("cannot resolve executable path: {e}"))?
            .parent()
            .ok_or_else(|| "cannot resolve executable directory".to_string())?
            .to_path_buf();
        if !exe_dir.join("engine.exe").exists() {
            return Err("bundled engine.exe not found next to the application".to_string());
        }
        Ok((
            "engine.exe".to_string(),
            exe_dir.to_string_lossy().to_string(),
        ))
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

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
