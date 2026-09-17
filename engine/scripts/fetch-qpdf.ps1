# Fetch the official qpdf release for Windows x64 into engine/qpdf-bin/ for
# development. Only the prebuilt MSVC binaries are copied: qpdf.exe depends on
# the sibling qpdf29.dll and the MSVC runtime DLLs shipped in the same zip, so
# the whole bin directory is needed (qpdf.exe alone crashes with 0xC0000135,
# STATUS_DLL_NOT_FOUND). Release builds do not use this script; build-release.ps1
# stages the same directory into engine-deps.tar (Task 13).
#
#   powershell engine/scripts/fetch-qpdf.ps1 [-Version 11.10.1] [-Force]
param(
    [string]$Version = "11.10.1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$binDir = Join-Path $PSScriptRoot "..\qpdf-bin"
$qpdfExe = Join-Path $binDir "qpdf.exe"

if ((Test-Path $qpdfExe) -and -not $Force) {
    Write-Output "qpdf already present: $qpdfExe"
    & $qpdfExe --version
    Write-Output ("sha256: " + (Get-FileHash -Algorithm SHA256 $qpdfExe).Hash.ToLower())
    exit 0
}

# qpdf ships "qpdf-<ver>-msvc64.zip" for Windows x64 (mingw32/msvc32 variants are
# 32-bit). Both the URL and the asset name are stable across 11.x.
$asset = "qpdf-$Version-msvc64.zip"
$url = "https://github.com/qpdf/qpdf/releases/download/v$Version/$asset"
# qpdf publishes a PGP-signed qpdf-<ver>.sha256 alongside every release; it is
# fetchable programmatically, so the download is verified against upstream before
# extraction. If it cannot be fetched (offline/asset renamed), the script prints
# both hashes for manual comparison instead of failing the fetch.
$shaUrl = "https://github.com/qpdf/qpdf/releases/download/v$Version/qpdf-$Version.sha256"

$tmp = Join-Path $env:TEMP "pogopdf-qpdf-$PID"
$zip = Join-Path $tmp $asset
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    Write-Output "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    $downloaded = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    Write-Output "downloaded sha256: $downloaded"

    $upstream = $null
    $note = $null
    try {
        $sumsFile = Join-Path $tmp "qpdf-$Version.sha256"
        Invoke-WebRequest -Uri $shaUrl -OutFile $sumsFile -UseBasicParsing
        $line = (Get-Content -LiteralPath $sumsFile | Where-Object {
            $_ -match "\s$([regex]::Escape($asset))\s*$"
        } | Select-Object -First 1)
        if ($line) { $upstream = ($line -split "\s+")[0].ToLower() }
    }
    catch {
        $note = $_.Exception.Message
    }
    if ($upstream) {
        Write-Output "upstream   sha256: $upstream"
        if ($downloaded -ne $upstream) {
            throw "sha256 mismatch for $asset (upstream $upstream)"
        }
    }
    else {
        Write-Output "WARNING: no upstream hash available ($note) - compare the downloaded hash above with $shaUrl manually"
    }

    $extract = Join-Path $tmp "extract"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract

    # The top-level directory is named after the asset stem.
    $srcBin = Join-Path $extract (Join-Path "qpdf-$Version-msvc64" "bin")
    if (-not (Test-Path $srcBin)) {
        throw "unexpected archive layout: $srcBin not found"
    }

    if (Test-Path $binDir) { Remove-Item -Recurse -Force $binDir }
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    # Only qpdf itself and its runtime (DLLs); skip the dev tools/libs.
    Copy-Item (Join-Path $srcBin "qpdf.exe") $binDir
    Copy-Item (Join-Path $srcBin "*.dll") $binDir

    Write-Output "qpdf -> $qpdfExe"
    & $qpdfExe --version
    if ($LASTEXITCODE -ne 0) { throw "qpdf.exe failed to run (exit $LASTEXITCODE)" }
    Write-Output ("sha256: " + (Get-FileHash -Algorithm SHA256 $qpdfExe).Hash.ToLower())
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
