# Native modules and SEA packing (decision note)

**Status:** placeholder decision recorded in Task 2; the packing work and its
verification happen in Task 10 (Release packing).

## Why this exists

The engine bundle (`engine.cjs`, esbuild) now depends on three packages that
are not pure JavaScript:

| Package | License | Native artifact |
|---|---|---|
| `@napi-rs/canvas` | MIT | `@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` (+ `icudtl.dat`) |
| `sharp` | Apache-2.0 | `@img/sharp-win32-x64/lib/sharp-win32-x64-*.node` + bundled libvips DLLs |
| `pdfjs-dist` | Apache-2.0 | pure JS, but it `require()`s `@napi-rs/canvas` internally |

On Windows there is **no separate `@img/sharp-libvips` runtime package**:
`@img/sharp-win32-x64` itself contains `lib/libvips-42.dll` and
`lib/libvips-cpp-*.dll` (verified in the installed tree). `@img/sharp-libvips-*`
exists only as a build-time/dev package for other platforms.

**License disclosure:** `@img/sharp-win32-x64` is Apache-2.0 AND
LGPL-3.0-or-later (it bundles libvips, which is LGPL-3.0). This is **not** AGPL
and is compatible with the open-source distribution.

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

**Option 2 / Option 1 hybrid** (the plan's recommendation). The layout below is
the corrected form — the earlier flat-`engine-deps/` + `module.paths` sketch did
not account for how Node resolution actually walks.

### The resolution facts that dictate the layout

- **sharp resolves its platform package by walking UP from its own directory.**
  `sharp` does `require("@img/sharp-win32-x64")`; Node looks in
  `sharp/node_modules`, then the parent directories. A flat
  `engine-deps/sharp` + `engine-deps/@img` layout fails because `@img` is not a
  parent-visible location. The staged tree must therefore be a real
  `node_modules` shape: **`engine-deps/node_modules/{sharp, @img/sharp-win32-x64,
  @napi-rs/canvas}`**.
- **`@img/sharp-win32-x64` hoists to the ROOT `node_modules/@img`** in an npm
  workspace, and it *bundles* the libvips DLLs (`lib/libvips-42.dll`,
  `lib/libvips-cpp-*.dll`). There is no separate Windows
  `@img/sharp-libvips-win32-x64` runtime package to copy.
- **`module.paths` mutation after init is unreliable** and must not be relied
  on. Resolution must come from the filesystem layout + the process cwd (or
  `NODE_PATH` set at spawn), not runtime `module.paths` patching.
- **`pdfjs-dist` itself is bundled into `engine.cjs`.** Only the natives and
  their package directories need staging. However, pdf.js calls
  `require("@napi-rs/canvas")` at runtime from bundled code, and bundled code
  has no `node_modules` location of its own — so `@napi-rs/canvas` must NOT be
  bundled; it must be marked `--external` and resolved at runtime from the
  staged tree. The same applies to `sharp`.

### Plan

- esbuild marks **`sharp` and `@napi-rs/canvas` external** (`--external:sharp
  --external:@napi-rs/canvas`) so the bundle emits runtime `require()` calls
  instead of inlining them. (These are exactly the two packages whose native
  `.node` artifacts cannot live inside the SEA blob.)
- `engine/scripts/build-release.ps1` stages
  `engine-deps/node_modules/sharp`, `engine-deps/node_modules/@img/sharp-win32-x64`,
  and `engine-deps/node_modules/@napi-rs/canvas` (+ `@napi-rs/canvas-win32-x64-msvc`
  if the runtime resolution needs the platform dir rather than the bundled
  `skia.*.node` — Task 10 verifies which one is picked by
  `@napi-rs/canvas`'s `js-binding.js` on Windows).
- The embedded blob becomes a ZIP of `engine.cjs` + `engine-deps/`; the existing
  runtime extractor unzips it to `%LOCALAPPDATA%\PogoPDF\bin\engine-<hash>\` and
  the engine is spawned with that directory as **cwd** (and/or `NODE_PATH` set to
  `engine-deps/node_modules`) so both the top-level `require("sharp")` and
  pdf.js's dynamic `require("@napi-rs/canvas")` resolve from the staged tree.

## What Task 10 must do

1. Implement the `engine-deps/node_modules/...` staging in `build-release.ps1`
   and the directory ZIP embedding.
2. Extend the cache extractor to unpack a directory (not just one file) and run
   the engine from it with cwd / `NODE_PATH` pointing at the staged tree.
3. **Verify end-to-end against the staged exe before `tauri build`**: pipe a
   `pdfToImages` job at the SEA `engine.exe` and confirm it writes real image
   files (not just that the process boots). This is the mandatory check — a
   "successful" build that cannot rasterize is a failure.

### Task 10 verifies (uncertain until tested against the real exe)

- Whether `@napi-rs/canvas-win32-x64-msvc` must be staged explicitly, or whether
  `@napi-rs/canvas`'s own `skia.win32-x64-msvc.node` sibling copy is used.
- Whether spawn `cwd` alone is sufficient or `NODE_PATH` is also required for
  pdf.js's internal `createRequire` call.
- The exact esbuild external syntax that survives the workspace layout.

## Dev-time note

Nothing here affects development: `npm run app` runs the engine through
`node --import tsx`, which loads pdf.js, `@napi-rs/canvas`, and sharp natively.
`pdfjs-dist` is pinned to `^6.3.289` and `@napi-rs/canvas` to `^1.0.9` in
`engine/package.json`; both live in `engine/node_modules` so pdf.js's internal
`createRequire` resolves the 1.x canvas (pdfjs-dist also lists
`@napi-rs/canvas` as an optional dependency).
