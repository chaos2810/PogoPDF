# Fetch the official Ghostscript release for Windows x64 into engine/gs-bin/ for
# development. Ghostscript backs the pdfToPdfA and fontOutline tools; release
# builds stage the same directory into engine-deps.tar (build-release.ps1).
#
#   powershell engine/scripts/fetch-ghostscript.ps1 [-Force]
#
# Extraction route (verified against gs 10.08.0 and the 7-Zip 26.03 build tools):
# the GS Windows build is an NSIS installer, and the standalone 7zr.exe and
# 7za.exe builds do NOT implement the NSIS handler ("Unsupported archive type").
# Only the full 7z.exe does. A clean Windows machine has neither, and the NSIS
# silent install (/S /D=) needs elevation and hangs without it, so this script
# bootstraps a full 7z.exe: it downloads the pinned 7zr.exe (which CAN read the
# 7-Zip installer's own 7z self-extracting archive), uses it to unpack 7z.exe +
# 7z.dll from the pinned official 7-Zip installer, and runs that pair with
# -tNsis. 7zr.exe, 7z.exe and 7z.dll are build-machine tools used only here in
# %TEMP%; they are never staged into gs-bin/ or shipped.
#
# Only the files the tools read are staged: bin/ (the gswin64c.exe console
# binary and gsdll64.dll), lib/ (PostScript resources), Resource/ (fonts and
# CMaps), iccprofiles/ (the sRGB profile the PDF/A OutputIntent embeds), and
# doc/COPYING (the AGPL-3.0 text the THIRD-PARTY-NOTICES rows reference). The
# rest of doc/ (~22.6 MB) and examples/ (~1.2 MB) are dropped.
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$gsVersion = "10.08.0"
$gsTag = "gs10080"
$gsAsset = "gs10080w64.exe"
# SHA-512 of the asset, cross-checked below against the upstream SHA512SUMS.
$gsSha512 = "cb3ecc798508851ba28b05e3fb914ddefe78168190726376d8581546ce61d5b216ffa3359e6f829072786bc12350501c7b6f99110d578696b87213d157774269"

# Pinned 7-Zip 26.03 build-machine tools (not shipped).
$sevenZipVersion = "26.03"
$sevenZiprAsset = "7zr.exe"
$sevenZiprSha256 = "ad4c82fadcbdf93c03b4fc440f300509c7d60c5c2f4d183e35d9d70d6957037d"
$sevenZipInstallerAsset = "7z2603-x64.exe"
$sevenZipInstallerSha256 = "0859c524b8a63551848f0c246abddcb1d0b7b656b0fbfe879f8d85e61a9e6edd"

$binDir = Join-Path $PSScriptRoot "..\gs-bin"
$gsExe = Join-Path $binDir "bin\gswin64c.exe"

if ((Test-Path $gsExe) -and -not $Force) {
    Write-Output "ghostscript already present: $gsExe"
    & $gsExe --version
    Write-Output ("sha256: " + (Get-FileHash -Algorithm SHA256 $gsExe).Hash.ToLower())
    exit 0
}

$gsUrl = "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/$gsTag/$gsAsset"
$sumsUrl = "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/$gsTag/SHA512SUMS"
$zrUrl = "https://github.com/ip7z/7zip/releases/download/$sevenZipVersion/$sevenZiprAsset"
$ziUrl = "https://github.com/ip7z/7zip/releases/download/$sevenZipVersion/$sevenZipInstallerAsset"

$tmp = Join-Path $env:TEMP "pogopdf-gs-$PID"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    Write-Output "Downloading $gsUrl"
    $gsFile = Join-Path $tmp $gsAsset
    Invoke-WebRequest -Uri $gsUrl -OutFile $gsFile -UseBasicParsing
    $downloaded = (Get-FileHash -Algorithm SHA512 $gsFile).Hash.ToLower()
    Write-Output "downloaded sha512: $downloaded"

    $upstream = $null
    $note = $null
    try {
        $sumsFile = Join-Path $tmp "SHA512SUMS"
        Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsFile -UseBasicParsing
        $line = (Get-Content -LiteralPath $sumsFile | Where-Object {
            $_ -match "\s$([regex]::Escape($gsAsset))\s*$"
        } | Select-Object -First 1)
        if ($line) { $upstream = ($line -split "\s+")[0].ToLower() }
    }
    catch {
        $note = $_.Exception.Message
    }
    if ($upstream) {
        Write-Output "upstream   sha512: $upstream"
        if ($downloaded -ne $upstream) {
            throw "sha512 mismatch for $gsAsset (upstream $upstream)"
        }
    }
    elseif ($downloaded -ne $gsSha512) {
        throw "sha512 mismatch for $gsAsset (pinned $gsSha512, got $downloaded)"
    }
    else {
        Write-Output "upstream sums unavailable ($note); matched the pinned sha512"
    }

    # Bootstrap a full 7z.exe. 7zr.exe reads the 7-Zip installer's 7z SFX and
    # extracts 7z.exe + 7z.dll, which carry the NSIS handler 7zr itself lacks.
    Write-Output "Downloading $zrUrl"
    $zr = Join-Path $tmp $sevenZiprAsset
    Invoke-WebRequest -Uri $zrUrl -OutFile $zr -UseBasicParsing
    $zrHash = (Get-FileHash -Algorithm SHA256 $zr).Hash.ToLower()
    if ($zrHash -ne $sevenZiprSha256) {
        throw "sha256 mismatch for $sevenZiprAsset (expected $sevenZiprSha256, got $zrHash)"
    }

    Write-Output "Downloading $ziUrl"
    $zi = Join-Path $tmp $sevenZipInstallerAsset
    Invoke-WebRequest -Uri $ziUrl -OutFile $zi -UseBasicParsing
    $ziHash = (Get-FileHash -Algorithm SHA256 $zi).Hash.ToLower()
    if ($ziHash -ne $sevenZipInstallerSha256) {
        throw "sha256 mismatch for $sevenZipInstallerAsset (expected $sevenZipInstallerSha256, got $ziHash)"
    }

    $z7dir = Join-Path $tmp "7z"
    & $zr x $zi "7z.exe" "7z.dll" "-o$z7dir" -y
    if ($LASTEXITCODE -ne 0) { throw "7zr failed to unpack 7z.exe from the installer (exit $LASTEXITCODE)" }
    $z7 = Join-Path $z7dir "7z.exe"
    if (-not (Test-Path $z7)) { throw "7z.exe not found after bootstrap: $z7" }
    Write-Output "7z.exe bootstrapped: $z7 (build-machine only, not staged)"

    $extract = Join-Path $tmp "extract"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    & $z7 x -tNsis $gsFile "-o$extract" -y
    if ($LASTEXITCODE -ne 0) { throw "7z failed to extract the Ghostscript NSIS installer (exit $LASTEXITCODE)" }

    foreach ($dir in @("bin", "lib", "Resource", "iccprofiles")) {
        if (-not (Test-Path (Join-Path $extract $dir))) {
            throw "unexpected installer layout: $dir not found"
        }
    }
    if (-not (Test-Path (Join-Path $extract "doc\COPYING"))) {
        throw "unexpected installer layout: doc\COPYING not found"
    }

    if (Test-Path $binDir) { Remove-Item -Recurse -Force $binDir }
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    foreach ($dir in @("bin", "lib", "Resource", "iccprofiles")) {
        Copy-Item (Join-Path $extract $dir) $binDir -Recurse
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $binDir "doc") | Out-Null
    Copy-Item (Join-Path $extract "doc\COPYING") (Join-Path $binDir "doc")

    Write-Output "ghostscript -> $gsExe"
    $version = & $gsExe --version
    if ($LASTEXITCODE -ne 0) { throw "gswin64c.exe failed to run (exit $LASTEXITCODE)" }
    if ($version.Trim() -ne $gsVersion) {
        throw "unexpected Ghostscript version: $version (expected $gsVersion)"
    }
    Write-Output "version: $version"

    $stats = Get-ChildItem $binDir -Recurse -File | Measure-Object Length -Sum
    Write-Output ("staged: {0} file(s), {1:N1} MB" -f $stats.Count, ($stats.Sum / 1MB))
    Write-Output ("sha256: " + (Get-FileHash -Algorithm SHA256 $gsExe).Hash.ToLower())
    Write-Output "AGPL text: $(Join-Path $binDir 'doc\COPYING')"
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
