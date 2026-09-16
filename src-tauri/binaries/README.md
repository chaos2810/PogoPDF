# Engine binary staging area

`build.rs` embeds **two** artifacts from this directory into the app binary: the
SEA `engine.exe` and `engine-deps.tar` (the bundled `engine.cjs` plus the native
`node_modules` it requires at runtime). Neither is shipped beside `pogopdf.exe`,
and Tauri's `externalBin` is not used.

Build them with `powershell engine/scripts/build-release.ps1` (from the repo
root), which stages `engine.exe` and `engine-deps.tar` here and prints both
SHA-256s. If the files are absent, `build.rs` embeds empty placeholder blobs so
`cargo check`/`cargo test`/`tauri dev` still work.

At runtime the release app extracts both to
`%LOCALAPPDATA%\PogoPDF\bin\` — as `engine-<id>.exe` and `engine-deps-<id>/`,
sharing one build id derived from both files — verifies them, and reuses the
cache on later launches. The engine is spawned with the extracted deps directory
as its working directory. See `engine/src/render/native-modules.md` for why the
payload is two parts rather than one blob.
