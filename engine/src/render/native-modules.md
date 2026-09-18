# Native modules and SEA packing (shipped design)

**Status:** implemented and verified in Task 10 (Release packing). This file
records what ships, not a plan.

## Why this exists

The engine bundle (`engine.cjs`, esbuild) depends on packages that are not pure
JavaScript:

| Package | License | Native artifact |
|---|---|---|
| `@napi-rs/canvas` | MIT | `@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` (+ `icudtl.dat`) |
| `sharp` | Apache-2.0 | `@img/sharp-win32-x64/lib/sharp-win32-x64-*.node` + bundled libvips DLLs |
| `pdfjs-dist` | Apache-2.0 | pure JS, but it `require()`s `@napi-rs/canvas` internally |

Two more packages cannot be inlined even though they are pure JS, because they
read files relative to their own package directory at runtime:

| Package | License | Runtime file load |
|---|---|---|
| `pdfkit` | MIT | `new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url)` at module load; standard fonts via `require('#standard-fonts/*')` |
| `jsdom` | MIT | `fs.readFileSync(path.resolve(__dirname, '../../../browser/default-stylesheet.css'))` at module load |
| `mupdf` | **AGPL-3.0-or-later** | ESM-only with a top-level `await import("node:fs")` plus `await libmupdf_wasm(...)`, which CJS output cannot express; loads `dist/mupdf-wasm.wasm` relative to its own dist dir |
| `tesseract.js` | Apache-2.0 | spawns a `worker_threads` worker from `src/worker-script/node/index.js` resolved relative to its own package dir; esbuild inlines the main module's `__dirname` into `dist/`, so the worker path resolves to a non-existent `worker-script/` beside `engine.cjs` (verified: `Cannot find module '...\worker-script\node\index.js'`). It then lazily `require()`s the matching `tesseract.js-core` wasm variant from its own package dir |

All of these are marked `--external` and their transitive dependency trees are
staged into `engine-deps-<id>/node_modules/` (see `build-release.ps1`, which
walks `dependencies` + `optionalDependencies` from a root list). `marked` and
`dompurify` are pure JS with no file loads and do bundle.

`mupdf` is loaded through a dynamic `import("mupdf")` in
`engine/src/render/mupdfengine.ts`, so esbuild leaves the `require`/import for
the runtime and the whole package (including the ~10 MB wasm binary) is staged.
The official MuPDF.js wasm build compiles the XPS module out
(`platform/wasm/tools/build.sh` passes `xps=no`), so the shipped engine reads
EPUB/FB2/comic content but not XPS; `xpsToPdf` reports a typed
unsupported-format error. A future custom wasm build with `xps=yes` would close
that gap without any code change beyond dropping the typed-error branch.

`qpdf` is not a Node package at all: `build-release.ps1` stages the whole
`engine/qpdf-bin/` directory (`qpdf.exe` + `qpdf29.dll` + the MSVC runtime DLLs;
a lone exe fails with `STATUS_DLL_NOT_FOUND`, 0xC0000135) into
`engine-deps-<id>/qpdf/`. That is exactly the location `resolveQpdf()`
(`engine/src/tools/secure/qpdfbin.ts`) resolves from the release spawn cwd, so
protect/unlock/flatten find the binary in both dev and release layouts. If
`qpdf-bin/` is absent the build warns loudly and still produces a release without
the secure tools (their runtime error is the typed "qpdf not found").

`LibreOffice` is likewise not a Node package: `build-release.ps1` stages the
trimmed `engine/lo-bin/` tree into `engine-deps-<id>/lo/`, which is exactly the
location `resolveSoffice()` (`engine/src/tools/office/libreoffice.ts`) resolves
from the release spawn cwd (`cwd/lo/program/soffice.exe`). `soffice.exe` is a
launcher that loads `soffice.bin` and every DLL from its own `program/`
directory, so the whole `program/` tree ships. Only the pieces headless PDF
conversion reads are staged, using `robocopy` with exclusions:

- `share/extensions/dict-*` (spell-check dictionaries, ~455 MB)
- all `*.mo` files (translated UI strings, ~262 MB)
- top-level `help/` (~11 MB; a few MB of nested help dirs inside share/extensions remain and are harmless), `readmes/` (~2 MB), `share/gallery/` (~13 MB)

That takes the staged tree from ~1504 MB raw to ~760 MB. Retained: `program/`,
`Fonts/`, `presets/`, `share/config`, `share/registry`, `share/xpdfimport`, and
the root license files (`license.txt`, `LICENSE.html`, `NOTICE`,
`CREDITS.fodt`, `version.ini` build id). The trim was verified by converting a
docx through it and extracting the PDF text. If `lo-bin/` is absent the build
warns loudly and omits the office tools (their runtime error is the typed
"LibreOffice not found"); the smoke test's office case skips with a note.

On Windows there is **no separate `@img/sharp-libvips` runtime package**:
`@img/sharp-win32-x64` itself contains `lib/libvips-42.dll` and
`lib/libvips-cpp-*.dll`. `@img/sharp-libvips-*` exists only as a build-time/dev
package for other platforms.

**License disclosure:** `@img/sharp-win32-x64` is Apache-2.0 AND
LGPL-3.0-or-later (it bundles libvips, which is LGPL-3.0). This is **not** AGPL
and is compatible with the open-source distribution.

## The resolution fact that dictates the design

A Node SEA executable's built-in `require()` is an **embedder require**: it
resolves Node built-ins only. `NODE_PATH`, the process cwd, and even patching
`Module._load` / `Module._resolveFilename` are all ignored for it (verified by
direct experiment). So the SEA blob cannot itself `require("sharp")` or
`require("@napi-rs/canvas")` from anywhere.

What *does* work is loading a **file from disk** through `createRequire()`: once
`engine.cjs` is loaded by Node's normal CJS loader, its own `require("sharp")`
calls resolve from `node_modules` relative to that file, exactly as in dev.
`pdf.js`'s internal `createRequire` calls work the same way, because they are
anchored at the bundle's own path.

This is why the release engine is a two-part payload rather than one blob.

## Shipped layout

`engine/scripts/build-release.ps1` builds two artifacts, and
`src-tauri/build.rs` embeds both:

1. **`engine.exe`** - a Node SEA whose `main` is `engine/sea-bootstrap.cjs`. The
   bootstrap locates the extracted deps directory and does
   `createRequire(<deps>/engine.cjs)(<deps>/engine.cjs)`, loading the real bundle
   from disk.
2. **`engine-deps.tar`** - the runtime tree the bundle needs:
   - `engine.cjs` (the esbuild bundle; pdf.js, pdf-lib, jszip, zod, contracts are
     all inlined)
   - `pdf.worker.mjs` (pdf.js's fake-worker module, loaded by a dynamic `import`)
    - `node_modules/pdfjs-dist/{package.json,standard_fonts/}` (the standard-font
      directory is resolved via `require.resolve("pdfjs-dist/package.json")` at
      runtime; the full `pdfjs-dist` package is **not** staged)
    - `node_modules/{sharp, @img/sharp-win32-x64, @img/colour, detect-libc,
      @napi-rs/canvas, @napi-rs/canvas-win32-x64-msvc}`
    - the transitive dependency trees of `pdfkit` and `jsdom` (both `--external`;
      ~48 MB, including `fontkit`, `linebreak`, `png-js`, `@noble/*` and
      `parse5`, `css-tree`, `undici`, `tough-cookie`, `whatwg-*`)
    - `qpdf/qpdf.exe` + `qpdf/qpdf29.dll` + the MSVC runtime DLLs, staged from
      `engine/qpdf-bin/` so `resolveQpdf()` finds them under the release cwd
    - `lo/program/soffice.exe` + the rest of the trimmed LibreOffice tree, staged
      from `engine/lo-bin/` so `resolveSoffice()` finds them under the release cwd
    - `ocr-data/*.traineddata`, staged from `engine/ocr-data/` so `resolveOcrDataDir()`
      finds them under the release cwd

Both artifacts share one **build id** (sha256 over both files) in their names:
`engine-<id>.exe` and `engine-deps-<id>/`. The bootstrap derives its deps
directory from its own `engine-<id>.exe` filename, so an upgraded install never
loads a stale `engine-deps-<old-id>/` sitting in the same cache directory. Keying
on the exe's own hash alone would be wrong - the exe contains only the bootstrap,
so a bundle-only change would leave the key unchanged.

### esbuild flags (single definition, in `engine/package.json`)

```
esbuild src/engine.ts --bundle --platform=node --target=node22 \
  --outfile=dist/engine.cjs \
  --external:sharp --external:@napi-rs/canvas \
  --external:pdfkit --external:jsdom --external:mupdf --external:tesseract.js \
  --define:import.meta.url=__filename
```

- `--external:sharp` / `--external:@napi-rs/canvas` keep them as runtime
  `require()` calls (the only two packages with un-bundleable `.node` files).
- `--external:pdfkit` / `--external:jsdom` / `--external:mupdf` /
  `--external:tesseract.js` keep them on disk because of the runtime file loads
  listed above; inlining pdfkit or jsdom makes the bundle throw at import
  (pdfkit: `ERR_INVALID_URL`, jsdom: `ENOENT .../default-stylesheet.css`),
  inlining mupdf fails the build outright (esbuild: "Top-level await is
  currently not supported with the cjs output format"), and inlining
  tesseract.js produces a bundle whose OCR worker path points at a
  non-existent `worker-script/` directory. `--packages=external` is deliberately
  **not** used: pdf.js, pdf-lib, jszip and zod bundle fine and keep the exe
  self-contained apart from these six.
- `--define:import.meta.url=__filename` matters: esbuild's CJS output stubs
  `import.meta` to `{}`, so pdf.js's `createRequire(import.meta.url)` would throw
  `ERR_INVALID_ARG_VALUE` and silently degrade (no `@napi-rs/canvas` polyfill, no
  standard fonts). Rewriting it to `__filename` points those lookups at the
  bundle on disk, where the staged tree is visible.

`build-release.ps1` invokes `npm run build -w @pogopdf/engine` instead of
repeating the esbuild command, so the two release paths cannot drift.

## Runtime flow

1. `main.rs` release path calls `engine_blob::ensure_runtime()`.
2. `engine_blob.rs` decompresses both zstd blobs, hash-verifies them, extracts
   `engine-<id>.exe` and unpacks `engine-deps.tar` into
   `%LOCALAPPDATA%\PogoPDF\bin\engine-deps-<id>\`. The deps dir gets a
   `.extracted` marker holding the tar's sha256; the marker (not re-hashing ~60 MB
   of files) is the cache-validity check. Extraction goes to a per-process
   `*.tmp` directory that is renamed into place, matching the exe's race
   handling.
3. The engine is spawned with the extracted **deps directory as cwd**. cwd is
   authoritative for the bootstrap; the filename-derived path and
   `POGOPDF_ENGINE_DEPS` are fallbacks for manual invocation.

## Dev-time note

Nothing here affects development: `npm run app` runs the engine through
`node --import tsx`, which loads pdf.js, `@napi-rs/canvas`, and sharp natively.
`pdfjs-dist` is pinned to `^6.3.289` and `@napi-rs/canvas` to `^1.0.9` in
`engine/package.json`; both live in `engine/node_modules`.

## Verification (Task 10, on the staged exe before packaging)

- `npm run build -w @pogopdf/engine` produces `dist/engine.cjs` (2.28 MB) with
  `sharp` and `@napi-rs/canvas` as the only non-builtin runtime requires.
- The staged `engine-<id>.exe`, run with an unrelated cwd and with a stale
  `engine-deps-<other-id>/` present, answers `engine.ping` and rasterizes a
  2-page fixture to real PNGs (`89 50 4E 47`) with clean stderr; jpg/png/webp/
  bmp/tiff, pdfToGreyscale, pdfToCbz, pdfToSvg, pdfToText, extractImages,
  viewMetadata and pageDimensions all succeed.
- After `npx tauri build`, a first launch with an empty cache extracts both
  artifacts (hashes match the staged files), spawns the engine child, closes
  cleanly, and leaves no zombies; a second launch reuses the cache untouched.
- `smoke-release.mjs` (Task 13) also drives a `protect` → `unlock` roundtrip on
  the staged engine: `protect` writes a `%PDF` that pdf-lib refuses to open
  without a password, `unlock` restores a loadable document with the same page
  count. Run against both the staged pair and the engine extracted under
  `%LOCALAPPDATA%\PogoPDF\bin\`, it proves `resolveQpdf()` finds the staged
  `qpdf/qpdf.exe` (and its DLLs) in the real release layout.
- `smoke-release.mjs` (Task 11, Phase 2) crafts a minimal docx through the shared
  `engine/src/testing/ooxml.ts` builder, converts it with the staged `lo/` tree,
  and reads the fixture text back out through `pdfToText`. That proves both that
  `resolveSoffice()` finds `lo/program/soffice.exe` under the release cwd and
  that the trimmed tree still performs a headless conversion. The case skips with
  a loud note when no `lo/` was staged, matching the qpdf missing-binary gate.
