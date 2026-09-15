# Build a single-file engine executable via Node's Single Executable Application (SEA).
# Output: engine/dist/engine.exe (standalone Node runtime + bundled engine)
$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "..")
try {
    # Bundle ESM TypeScript (engine + workspace contracts + npm deps) to a CJS file.
    npx esbuild src/engine.ts --bundle --platform=node --target=node20 --outfile=dist/engine.cjs

    # Generate the SEA preparation blob from sea-config.json.
    node --experimental-sea-config sea-config.json

    # Start from the current Node runtime, then inject the blob.
    Copy-Item (Get-Command node).Source dist/engine.exe

    npx postject dist/engine.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite

    Write-Output "Built dist/engine.exe - copy to ../src-tauri/binaries/engine-x86_64-pc-windows-msvc.exe"
}
finally {
    Pop-Location
}
