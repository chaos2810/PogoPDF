# Native modules and SEA packing (decision note)

**Status:** placeholder decision recorded in Task 2; the packing work and its
verification happen in Task 10 (Release packing).

## Why this exists

The engine bundle (`engine.cjs`, esbuild) now depends on three packages that
are not pure JavaScript:

| Package | License | Native artifact |
|---|---|---|
| `@napi-rs/canvas` | MIT | `@napi-rs/canvas-win32-x64-msvc/*.node` (Skia-based) |
| `sharp` | Apache-2.0 | `@img/sharp-win32-x64/*.node` + `@img/sharp-libvips-win32-x64` |
| `pdfjs-dist` | Apache-2.0 | pure JS, but it `require()`s `@napi-rs/canvas` internally |

pdf.js is not itself native but resolves `@napi-rs/canvas` through
`process.getBuiltinModule("module").createRequire(import.meta.url)` in its Node
paths, so it must be able to resolve that package at runtime.

A bare Node SEA executable cannot `require()` a prebuilt `.node` file that lives
outside the blob, and these packages also read sibling data files (libvips
shared libraries, `.so/.dll` deps). So the engine cannot ship as a single
`engine.cjs` blob alone.

## Options (from the plan)

1. **esbuild `--packages=external` + node_modules subset beside the exe**, with
   the embedded blob becoming a ZIP (engine.cjs + deps) extracted to the cache
   dir. Requires extending the extractor from single-file to directory.
2. **Static-copy natives**: bundle everything except the two native deps; they
   stay as `node_modules` beside the exe at runtime.
3. **Replace natives** — rejected in the plan (would force raster tools to be
   dev-only, which is dishonest).

## Chosen direction (to be executed and verified in Task 10)

**Option 2 / Option 1 hybrid** (the plan's recommendation):

- esbuild marks `sharp` and `@napi-rs/canvas` external.
- `engine/scripts/build-release.ps1` copies `node_modules/sharp`,
  `node_modules/@img`, and `node_modules/@napi-rs/canvas` into an `engine-deps/`
  directory staged next to `src-tauri/binaries/engine.exe`.
- The embedded blob becomes a ZIP of `engine.cjs` + `engine-deps/`; the existing
  runtime extractor unzips it to `%LOCALAPPDATA%\PogoPDF\bin\engine-<hash>\` and
  the engine is spawned with that directory as cwd.
- Bootstrap adds the extracted `engine-deps` path to `module.paths` so the
  dynamic `require("@napi-rs/canvas")` inside pdf.js resolves.

## What Task 10 must do

1. Implement the `engine-deps/` copy in `build-release.ps1` and the directory
   ZIP embedding.
2. Extend the cache extractor to unpack a directory (not just one file) and run
   the engine from it.
3. **Verify end-to-end against the staged exe before `tauri build`**: pipe a
   `pdfToImages` job at the SEA `engine.exe` and confirm it writes real image
   files (not just that the process boots). This is the mandatory check — a
   "successful" build that cannot rasterize is a failure.

## Dev-time note

Nothing here affects development: `npm run app` runs the engine through
`node --import tsx`, which loads pdf.js, `@napi-rs/canvas`, and sharp natively.
`pdfjs-dist` is pinned to `^6.3.289` and `@napi-rs/canvas` to `^1.0.9` in
`engine/package.json`; both live in `engine/node_modules` so pdf.js's internal
`createRequire` resolves the 1.x canvas (pdfjs-dist also lists
`@napi-rs/canvas` as an optional dependency).
