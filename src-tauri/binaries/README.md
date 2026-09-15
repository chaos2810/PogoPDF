# Engine binary staging area

`build.rs` embeds `engine.exe` from this directory into the app binary; the file
is **not** shipped beside `pogopdf.exe` and Tauri's `externalBin` is no longer
used.

Build it with `powershell engine/scripts/build-release.ps1` (from the repo
root), which stages the plain-named `engine.exe` here and prints its SHA-256.
If the file is absent, `build.rs` embeds an empty placeholder blob so
`cargo check`/`cargo test`/`tauri dev` still work.

At runtime the release app extracts the embedded engine to
`%LOCALAPPDATA%\PogoPDF\bin\engine-<hash>.exe`, verifies it, and reuses the
cache on later launches. It records the engine size and SHA-256 at build time
(`build.rs`); a new engine build produces a new hash-named file. See
`engine/scripts/build-release.ps1` for the staging details.
