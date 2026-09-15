# Sidecar binaries

Tauri expects external binaries here named `<name>-<target-triple><.exe>`.
For Windows x64: `engine-x86_64-pc-windows-msvc.exe`.

Build it with: `powershell engine/scripts/build-release.ps1` (from the repo
root), then copy `engine/dist/engine.exe` to
`src-tauri/binaries/engine-x86_64-pc-windows-msvc.exe`.

Tauri renames the sidecar to `engine.exe` and places it next to the main
executable in the installed app, matching `engine_launch_spec` in
`src-tauri/src/main.rs`.
