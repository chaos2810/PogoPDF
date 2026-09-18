# Build the single-file engine executable via Node's Single Executable
# Application (SEA) plus the native dependency archive it loads at runtime.
#
# Output (staged into src-tauri/binaries/, which build.rs embeds):
#   engine.exe        SEA runtime + bootstrap (loads engine.cjs from the deps dir)
#   engine-deps.tar   engine.cjs + pdf.js runtime files + native node_modules
$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "..")
try {
    # Local devDependency binary for deterministic builds (no npx resolution).
    $postject = Join-Path $PSScriptRoot "..\..\node_modules\.bin\postject.CMD"

    # Bundle ESM TypeScript (engine + workspace contracts + npm deps) to a CJS
    # file. The esbuild invocation lives in engine/package.json (sharp and
    # @napi-rs/canvas external, import.meta.url -> __filename); invoking it here
    # keeps the two release paths in sync instead of duplicating the flags.
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    Push-Location $repoRoot
    try {
        & npm run build -w @pogopdf/engine
        if ($LASTEXITCODE -ne 0) { throw "engine bundle build failed with exit code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }

    # Stage the runtime dependency tree: engine-deps/node_modules/... plus the
    # pdf.js artifacts that the bundled code loads at runtime (its worker module
    # and the standard-font directory).
    $deps = Join-Path $PSScriptRoot "..\dist\engine-deps"
    if (Test-Path $deps) { Remove-Item -Recurse -Force $deps }
    $nm = Join-Path $deps "node_modules"
    New-Item -ItemType Directory -Force -Path $nm | Out-Null

    Copy-Item dist/engine.cjs $deps

    # Resolve each package's real directory from the engine package so hoisting
    # differences (sharp lives at the workspace root) do not matter. Written to
    # a temp file because inline `node -e` mangles nested quotes in PowerShell.
    $resolveScript = @'
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const req = createRequire(path.join(process.argv[2], "package.json"));
// Export maps differ (sharp exports "./package", most export "./package.json"),
// and a package entry point may sit in a subdirectory (sharp -> dist/index.cjs).
// Resolve an entry, then walk up to the nearest directory whose package.json
// declares the spec's name - that directory is the package root to copy.
function resolveDir(spec) {
  const anchors = ["/package.json", "/package", ""];
  let resolved;
  for (const suffix of anchors) {
    try {
      resolved = req.resolve(spec + suffix);
      break;
    } catch {
      /* try the next anchor */
    }
  }
  if (!resolved) throw new Error("cannot resolve entry for " + spec);
  let dir = path.dirname(resolved);
  while (true) {
    const pkgJson = path.join(dir, "package.json");
    if (fs.existsSync(pkgJson)) {
      const name = JSON.parse(fs.readFileSync(pkgJson, "utf8")).name;
      if (name === spec) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("no package root for " + spec);
    dir = parent;
  }
}
// Roots that are marked --external in engine/package.json (so their modules
// must exist on disk) plus sharp's platform packages, which are optional and
// therefore not reachable by walking dependencies. pdfkit and jsdom are
// external because they read data files relative to their own package dirs
// (`js/pdfkit.node.mjs` -> ./data/sRGB...icc, jsdom -> default-stylesheet.css),
// which breaks when esbuild inlines them. mupdf is external because it is
// ESM-only with a top-level await that CJS output cannot express, and it loads
// its wasm file relative to its own dist directory. tesseract.js is external
// because it spawns a worker thread from `src/worker-script/node/index.js`
// beside its own package dir, a path that does not exist once esbuild inlines
// the main module into engine.cjs.
const roots = ["sharp", "@napi-rs/canvas", "pdfkit", "jsdom", "mupdf", "tesseract.js"];
const extras = ["@img/sharp-win32-x64", "@img/colour", "detect-libc",
                "@napi-rs/canvas-win32-x64-msvc"];
const seen = new Set();
const queue = [...roots];
while (queue.length > 0) {
  const spec = queue.shift();
  if (seen.has(spec)) continue;
  let dir;
  try {
    dir = resolveDir(spec);
  } catch {
    // Platform-specific optional packages for other OSes are not installed.
    continue;
  }
  seen.add(spec);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const dep of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) })) {
    queue.push(dep);
  }
}

const out = {};
for (const spec of seen) {
  const dir = resolveDir(spec);
  out[spec] = dir;
}
for (const spec of extras) {
  try {
    out[spec] = resolveDir(spec);
  } catch {
    /* optional platform package not installed on this platform */
  }
}
process.stdout.write(JSON.stringify(out));
'@
    $resolvePath = Join-Path $env:TEMP "pogopdf-resolve-deps-$PID.cjs"
    Set-Content -LiteralPath $resolvePath -Value $resolveScript -Encoding utf8
    try {
        $pkgDirs = & node $resolvePath (Resolve-Path .).Path | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw "package resolution failed" }
    }
    finally {
        Remove-Item -Force $resolvePath -ErrorAction SilentlyContinue
    }

    # A package dir may itself contain node_modules (sharp vendors semver); copy
    # the whole directory so that nested resolution keeps working.
    foreach ($spec in $pkgDirs.PSObject.Properties.Name) {
        $src = $pkgDirs.$spec
        if (-not (Test-Path $src)) { throw "resolved package dir missing: $src" }
        $dest = Join-Path $nm $spec
        New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
        Copy-Item -Recurse $src $dest
    }

    # pdf.js is bundled into engine.cjs, but two of its runtime file loads are
    # not: the fake-worker module (dynamic import of pdf.worker.mjs) and the
    # standard-font directory (resolved via require.resolve at runtime).
    $pdfjs = Join-Path (Resolve-Path .).Path "node_modules\pdfjs-dist"
    if (-not (Test-Path $pdfjs)) {
        $pdfjs = Join-Path (Resolve-Path ..\..).Path "node_modules\pdfjs-dist"
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $nm "pdfjs-dist") | Out-Null
    Copy-Item (Join-Path $pdfjs "package.json") (Join-Path $nm "pdfjs-dist")
    Copy-Item -Recurse (Join-Path $pdfjs "standard_fonts") (Join-Path $nm "pdfjs-dist")
    Copy-Item (Join-Path $pdfjs "legacy\build\pdf.worker.mjs") $deps

    # qpdf (Apache-2.0) backs the secure tools (protect/unlock/flatten). The
    # WHOLE bin dir is required: qpdf.exe is a thin launcher that loads qpdf29.dll
    # and the MSVC runtime DLLs from its own directory, so a lone exe dies with
    # STATUS_DLL_NOT_FOUND (0xC0000135). Staged at qpdf/ because resolveQpdf
    # (qpdfbin.ts) resolves <deps>/qpdf/qpdf.exe from the release spawn cwd.
    $qpdfSrc = Join-Path (Resolve-Path .).Path "qpdf-bin"
    $qpdfDest = Join-Path $deps "qpdf"
    if (Test-Path (Join-Path $qpdfSrc "qpdf.exe")) {
        New-Item -ItemType Directory -Force -Path $qpdfDest | Out-Null
        Copy-Item (Join-Path $qpdfSrc "*") $qpdfDest -Recurse
    }
    else {
        Write-Warning "qpdf-bin/qpdf.exe not found: the release will omit qpdf and protect/unlock/flatten will fail at runtime with 'qpdf not found'. Run engine/scripts/fetch-qpdf.ps1 and rebuild."
    }

    # OCR language data (Apache-2.0 tesseract traineddata). Staged at ocr-data/
    # in the deps tar; resolveOcrDataDir (render/ocr.ts) resolves <deps>/ocr-data
    # from the release spawn cwd. Without it the ocr tool fails typed with
    # UNSUPPORTED_FORMAT and never reaches tesseract's online CDN fallback.
    $ocrSrc = Join-Path (Resolve-Path .).Path "ocr-data"
    $ocrDest = Join-Path $deps "ocr-data"
    if (Test-Path $ocrSrc) {
        New-Item -ItemType Directory -Force -Path $ocrDest | Out-Null
        Copy-Item (Join-Path $ocrSrc "*.traineddata") $ocrDest
        $ocrCount = (Get-ChildItem -Path $ocrDest -Filter *.traineddata).Count
        Write-Output "ocr-data: staged $ocrCount traineddata file(s) at ocr-data/ in the deps tar"
    }
    else {
        Write-Warning "ocr-data not found: the release will omit OCR language data and the ocr tool will fail at runtime with 'language data not found'. Run engine/scripts/fetch-ocr-data.ps1 and rebuild."
    }

    # LibreOffice (MPL-2.0) backs officeToPdf for doc/docx/rtf/odt/xls/xlsx/ods/
    # ppt/pptx/odp/odg. The whole tree is staged at lo/, because resolveSoffice
    # (office/libreoffice.ts) resolves <deps>/lo/program/soffice.exe from the
    # release spawn cwd, and soffice.exe is a launcher that loads soffice.bin plus
    # its DLLs from its own program/ directory.
    #
    # Only the pieces headless PDF conversion needs are staged. robocopy is used
    # because the exclusion list mixes directory names (help, readmes,
    # share/gallery), a wildcard directory family (share/extensions/dict-*), and
    # a file wildcard (*.mo). Dictionaries are spell-check data, .mo files are
    # translated UI strings, and help/readmes/gallery are never read by
    # `--headless --convert-to`; together they are ~740 MB of the 1.5 GB tree.
    # A missing tree warns loudly and skips, matching the qpdf/ocr-data pattern:
    # the release still builds, the office tools fail typed at runtime, and the
    # smoke test's office case is skipped with a note.
    $loSrc = Join-Path (Resolve-Path .).Path "lo-bin"
    $loDest = Join-Path $deps "lo"
    if (Test-Path (Join-Path $loSrc "program\soffice.exe")) {
        # robocopy copies from a source into a destination root; stage into lo/
        # under the deps root rather than copying lo-bin/ to a sibling.
        $dictDirs = Get-ChildItem (Join-Path $loSrc "share\extensions") -Directory -Filter "dict-*" -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }
        $exclDirs = @() + $dictDirs + @(
            (Join-Path $loSrc "help"),
            (Join-Path $loSrc "readmes"),
            (Join-Path $loSrc "share\gallery")
        )
        # /NFL /NDL /NJH /NP keep the per-file/per-dir lines out of the build log.
        & robocopy $loSrc $loDest /E /XD @exclDirs /XF *.mo /NFL /NDL /NJH /NP | Out-Null
        # robocopy exit codes 0..7 are success (bit flags for copied/skipped/
        # mismatched items); 8 and above are failures.
        if ($LASTEXITCODE -ge 8) { throw "robocopy of LibreOffice failed with exit code $LASTEXITCODE" }
        $loStats = Get-ChildItem $loDest -Recurse -File | Measure-Object Length -Sum
        $loMb = "{0:N1} MB" -f ($loStats.Sum / 1MB)
        Write-Output "lo: staged $($loStats.Count) file(s), $loMb at lo/ in the deps tar (trimmed: dict-*, *.mo, help/, readmes/, gallery/)"
    }
    else {
        Write-Warning "lo-bin not found: the release will omit LibreOffice and officeToPdf (docx/xlsx/pptx/odt/...) will fail at runtime with 'LibreOffice not found'. Run engine/scripts/fetch-libreoffice.ps1 and rebuild."
    }

    # Archive the tree (bsdtar ships with Windows 10+). Extracted at runtime by
    # the Rust app into %LOCALAPPDATA%\PogoPDF\bin\engine-<hash>\.
    $depsTar = Join-Path (Resolve-Path .).Path "dist\engine-deps.tar"
    if (Test-Path $depsTar) { Remove-Item -Force $depsTar }
    & tar -cf $depsTar -C $deps .
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }

    # Generate the SEA preparation blob from the bootstrap (not the bundle): the
    # embedded runtime can only require built-ins, so the bootstrap loads
    # engine.cjs from the extracted deps dir through createRequire.
    node --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { throw "node --experimental-sea-config failed with exit code $LASTEXITCODE" }

    # Start from the current Node runtime, then inject the blob.
    Copy-Item (Get-Command node).Source dist/engine.exe

    & $postject dist/engine.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
    if ($LASTEXITCODE -ne 0) { throw "postject failed with exit code $LASTEXITCODE" }

    # Stage the artifacts that build.rs embeds into the app binary.
    # ($ErrorActionPreference = "Stop" makes a failed copy throw.)
    $binDir = Join-Path $PSScriptRoot "..\..\src-tauri\binaries"
    $destExe = Join-Path $binDir "engine.exe"
    $destDeps = Join-Path $binDir "engine-deps.tar"
    Copy-Item dist/engine.exe $destExe -Force
    Copy-Item $depsTar $destDeps -Force

    $exeSha = (Get-FileHash -Algorithm SHA256 $destExe).Hash.ToLower()
    $depsSha = (Get-FileHash -Algorithm SHA256 $destDeps).Hash.ToLower()
    Write-Output "Built dist/engine.exe -> src-tauri/binaries/engine.exe"
    Write-Output "size: $((Get-Item $destExe).Length) bytes"
    Write-Output "sha256: $exeSha"
    Write-Output "Built dist/engine-deps.tar -> src-tauri/binaries/engine-deps.tar"
    Write-Output "size: $((Get-Item $destDeps).Length) bytes"
    Write-Output "sha256: $depsSha"
    if (Test-Path (Join-Path $qpdfDest "qpdf.exe")) {
        $dllCount = (Get-ChildItem -Path $qpdfDest -Filter *.dll).Count
        Write-Output "qpdf: staged $dllCount DLL(s) + qpdf.exe at qpdf/ in the deps tar"
        Write-Output "qpdf.exe sha256: $((Get-FileHash -Algorithm SHA256 (Join-Path $qpdfDest 'qpdf.exe')).Hash.ToLower())"
    }
    else {
        Write-Output "qpdf: NOT staged (secure tools unavailable in this release)"
    }
}
finally {
    Pop-Location
}
