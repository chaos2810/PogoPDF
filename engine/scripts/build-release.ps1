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
    & $esbuild src/engine.ts --bundle --platform=node --target=node22 --outfile=dist/engine.cjs
    if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }

    # Generate the SEA preparation blob from sea-config.json.
    node --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { throw "node --experimental-sea-config failed with exit code $LASTEXITCODE" }

    # Start from the current Node runtime, then inject the blob.
    Copy-Item (Get-Command node).Source dist/engine.exe

    & $postject dist/engine.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
    if ($LASTEXITCODE -ne 0) { throw "postject failed with exit code $LASTEXITCODE" }

    # Stage the plain-named exe that build.rs embeds into the app binary.
    # ($ErrorActionPreference = "Stop" makes a failed copy throw.)
    $dest = Join-Path $PSScriptRoot "..\..\src-tauri\binaries\engine.exe"
    Copy-Item dist/engine.exe $dest -Force

    $sha = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
    Write-Output "Built dist/engine.exe -> src-tauri/binaries/engine.exe"
    Write-Output "size: $((Get-Item $dest).Length) bytes"
    Write-Output "sha256: $sha"
}
finally {
    Pop-Location
}
