# Build a single-file engine executable via Node's Single Executable Application (SEA).
# Output: engine/dist/engine.exe (standalone Node runtime + bundled engine)
$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "..")
try {
    # Local devDependency binaries for deterministic builds (no npx resolution).
    $bin = Join-Path $PSScriptRoot "..\..\node_modules\.bin"
    $esbuild = Join-Path $bin "esbuild.CMD"
    $postject = Join-Path $bin "postject.CMD"

    # Bundle ESM TypeScript (engine + workspace contracts + npm deps) to a CJS file.
    & $esbuild src/engine.ts --bundle --platform=node --target=node20 --outfile=dist/engine.cjs
    if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }

    # Generate the SEA preparation blob from sea-config.json.
    node --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { throw "node --experimental-sea-config failed with exit code $LASTEXITCODE" }

    # Start from the current Node runtime, then inject the blob.
    Copy-Item (Get-Command node).Source dist/engine.exe

    & $postject dist/engine.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
    if ($LASTEXITCODE -ne 0) { throw "postject failed with exit code $LASTEXITCODE" }

    Write-Output "Built dist/engine.exe - copy to ../src-tauri/binaries/engine-x86_64-pc-windows-msvc.exe"
}
finally {
    Pop-Location
}
