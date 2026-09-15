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
esbuild. It is only used for release packaging (see below); dev runs the
TypeScript entry directly, so you do not need to run it day to day:

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

## Packaging (release)

Release packaging is handled in Task 11. In short:

```
npx tauri build
```

(run from the repo root)
This runs `npm run build -w ui` first, then produces the installers listed in
`tauri.conf.json` (`msi`, `nsis`). Release builds expect a bundled engine
sidecar next to the executable: `engine.exe`. The release branch of
`engine_launch_spec` resolves it from the executable's own directory and errors
if it is missing.
