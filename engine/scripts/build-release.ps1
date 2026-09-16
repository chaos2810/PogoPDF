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
// declares the spec's name — that directory is the package root to copy.
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
const out = {};
for (const spec of ["sharp", "@img/sharp-win32-x64", "@img/colour", "detect-libc",
                    "@napi-rs/canvas", "@napi-rs/canvas-win32-x64-msvc"]) {
  out[spec] = resolveDir(spec);
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
}
finally {
    Pop-Location
}
