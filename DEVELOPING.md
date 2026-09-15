# Developing PogoPDF

PogoPDF is a Tauri 2 desktop app: a Rust shell (`src-tauri/`) hosts a React UI
(`ui/`) and spawns a long-lived Node engine (`engine/`) that does the PDF work.
The UI calls the Rust shell over Tauri `invoke` commands, and the shell talks to
the engine over JSON-RPC 2.0 on stdio.

## Prerequisites

- Node 20+ (developed on v24.18.0)
- Rust stable + cargo (developed on 1.97.1)
- WebView2 runtime (bundled with current Windows)
- Tauri CLI is installed as a root devDependency (`@tauri-apps/cli`), so it runs
  via the local `tauri` binary after `npm install`; no global install needed.

## One-time setup

```
npm install
```

Installs all npm workspaces (`packages/*`, `engine`, `ui`) from the repo root.
Cargo dependencies for the shell are fetched on the first build.

## Daily dev loop

Start the whole app from the repo root:

```
npm run app
```

This is a proxy for `tauri dev`, which reads `src-tauri/tauri.conf.json`:

- `beforeDevCommand` runs `npm run dev -w ui` — Vite serves the UI on
  http://localhost:5173.
- The Rust shell is compiled and launched, and loads `devUrl`.
- At startup the shell spawns the engine with the **dev** launch spec from
  `src-tauri/src/main.rs` (`engine_launch_spec`):

  ```
  node --import tsx src/engine.ts
  ```

  run with `engine/` as the working directory, so Node resolves the engine's own
  `node_modules` and `tsx` transpiles TypeScript on the fly. **No engine build
  step is required in dev** — edit `engine/src/*.ts` and restart the app to pick
  up changes. Set the `POGOPDF_ENGINE_CMD` environment variable to override the
  command (for example, to point at a bundled `dist/engine.cjs`).

Closing the app window kills the engine child process; there should be no
lingering `node` process afterwards.

### Rebuilding the engine bundle (not needed for dev)

`engine/package.json` has a `build` script that produces `dist/engine.cjs` via
esbuild. It is only used as an intermediate step for release packaging (see
below); dev runs the TypeScript entry directly, so you do not need to run it day
to day:

```
npm run build -w @pogopdf/engine
```

## Tests and typechecks

```
npm test -w @pogopdf/contracts
npm test -w @pogopdf/engine
npm test -w @pogopdf/i18n
npm test -w @pogopdf/ui
npm run typecheck -w @pogopdf/engine
npm run typecheck -w @pogopdf/i18n
npm run typecheck -w @pogopdf/ui
```

From `src-tauri/` you can also run `cargo check` and `cargo test`.

## Manual QA checklist

There is no automated UI driver in this repo, so exercise these by hand in
`npm run app`:

- [ ] The PogoPDF window opens and the home screen shows the Merge tool card.
- [ ] Press Ctrl+K: the command palette opens and can navigate to a tool.
- [ ] Open Merge, add two PDFs via the file picker, click Merge.
- [ ] The progress bar advances; a Save As dialog appears; saving produces a
      merged PDF that opens correctly.
- [ ] Toggle the theme (light/dark) and confirm it persists.
- [ ] Toggle the UI language and confirm strings change.
- [ ] Close the window and confirm no `node.exe` (engine) process is left in
      Task Manager.
- [ ] Start a large merge, close the window mid-job, and confirm the engine
      exits immediately (no lingering `node.exe`) rather than after the job
      finishes. This exercises the sidecar read/write lock split.

### Installed build

- [ ] Install from `src-tauri/target/release/bundle/msi/` (or `.../nsis/`).
- [ ] Launch PogoPDF from the Start Menu.
- [ ] Merge two PDFs and confirm the output opens correctly.
- [ ] Close and confirm no `engine-*` process is left in Task Manager (for
      example, `Get-Process engine*` in PowerShell).
- [ ] Start a large merge, close the window mid-progress, and confirm no
      `engine-*` process remains in Task Manager.

## Packaging (release)

Release produces a **single-file install**: the engine is embedded inside
`pogopdf.exe` and there is no `engine.exe` beside it. The engine is still built
as a standalone executable using Node's
[Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
(SEA) support, but the build compresses it and links it into the app binary.

### 1. Build the engine executable

From the repo root (requires Node >= 20 on the build machine; developed on
v24.18.0):

```
powershell engine/scripts/build-release.ps1
```

The script bundles `engine/src/engine.ts` (plus the workspace `@pogopdf/contracts`
package and all npm dependencies) to `engine/dist/engine.cjs` with esbuild,
generates a SEA blob via `node --experimental-sea-config`, copies the current
`node.exe`, injects the blob with `postject`, and stages the result at
`src-tauri/binaries/engine.exe`. It prints the size and SHA-256 of the staged
file. The result is a standalone engine with no external Node runtime
dependency. You can smoke-test it directly:

```
'{"jsonrpc":"2.0","id":1,"method":"engine.ping"}' | .\engine\dist\engine.exe
# {"jsonrpc":"2.0","id":1,"result":{"pong":true}}
```

`src-tauri/build.rs` runs before the Rust shell compiles: it zstd-compresses
`src-tauri/binaries/engine.exe`, records its raw size and SHA-256, and embeds
both into the app binary. If the file is absent the build still succeeds with an
empty placeholder blob (so `cargo check`/`test`/`tauri dev` work without the
~90 MB engine), but a release app built that way has no engine to run.

### 2. Build the installers

```
npx tauri build
```

(run from the repo root)
This runs `npm run build -w ui` first, compiles the Rust shell in release mode,
and produces the installers listed in `tauri.conf.json` (`msi`, `nsis`) under
`src-tauri/target/release/bundle/`. The first run downloads the WiX and NSIS
toolchains and can take several minutes. If the staged engine from step 1 is
stale or missing, the release build still succeeds but bundles an app that
cannot start its engine — rebuild the engine first.

### Runtime extraction

On first launch the release app decompresses the embedded engine to
`%LOCALAPPDATA%\PogoPDF\bin\engine-<hash>.exe`, verifies the written bytes
against the embedded SHA-256, and renames the verified temp file into place.
The cache is reused on subsequent launches while the app's recorded engine size
matches; a new engine build produces a new hash-named file. Keeping the engine
out of the install directory means the installer ships one executable instead of
two, and the per-user cache avoids re-extracting on every run. Closing the app
still kills the engine (see the zombie-process guard); there should be no
lingering `engine.exe` process afterwards.

### Icons

The icon set in `src-tauri/icons/` is generated with the Tauri CLI from a single
source PNG:

```
npx tauri icon path\to\source.png
```
