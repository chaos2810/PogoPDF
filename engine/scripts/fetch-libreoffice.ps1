# Fetch the LibreOffice program tree for dev-time office conversion.
# The tree stages into engine/lo-bin/ (gitignored); the release script packs
# it into the deps tar like qpdf. No install happens: msiexec /a is an
# administrative (extract-only) install that writes no registry entries.
$ErrorActionPreference = "Stop"

# Pinned to 26.2.6: this is the staged and tested tree. 26.8.0 also exists on the
# mirror (the earlier 404 was transient propagation), but changing the pin means a
# fresh 350 MB fetch and a full re-test, so the pin is deliberate for now.
$version = "26.2.6"
$msiName = "LibreOffice_${version}_Win_x86-64.msi"
$url = "https://download.documentfoundation.org/libreoffice/stable/${version}/win/x86_64/${msiName}"
$engineDir = Split-Path -Parent $PSScriptRoot
$stageDir = Join-Path $engineDir "lo-bin"
$msiPath = Join-Path $env:TEMP $msiName

if (Test-Path (Join-Path $stageDir "program\soffice.exe")) {
    Write-Output "LibreOffice already staged at $stageDir"
    exit 0
}

Write-Output "Downloading $url (~350 MB)..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $msiPath -UseBasicParsing
$msiHash = (Get-FileHash $msiPath -Algorithm SHA256).Hash
Write-Output "msi sha256: $msiHash"

Write-Output "Extracting (administrative install, no registry writes)..."
$extractDir = Join-Path $env:TEMP "lo-extract"
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
$proc = Start-Process msiexec -ArgumentList "/a", "`"$msiPath`"", "/qn", "TARGETDIR=`"$extractDir`"" -Wait -PassThru
if ($proc.ExitCode -ne 0) { throw "msiexec /a failed with exit code $($proc.ExitCode)" }

if (-not (Test-Path (Join-Path $extractDir "program\soffice.exe"))) {
    throw "extraction did not produce program\soffice.exe"
}

if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
Move-Item $extractDir $stageDir

$soffice = Join-Path $stageDir "program\soffice.exe"
# Read the version from version.ini instead of running `soffice --version`:
# direct synchronous `--version` invocation of soffice.exe has been observed to
# hang (it can start a persistent process instead of exiting), so the script
# never blocks on the binary.
$versionIni = Join-Path $stageDir "program\version.ini"
# Tolerant read: a tree without a buildid= line prints "unknown" instead of
# throwing, since $ErrorActionPreference is Stop.
$buildIdMatch = Select-String -Path $versionIni -Pattern '^buildid=' -ErrorAction SilentlyContinue
$buildId = if ($buildIdMatch) { $buildIdMatch.Line -replace '^buildid=', '' } else { "unknown" }
$size = "{0:N0} MB" -f ((Get-ChildItem $stageDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
Write-Output "staged: $soffice"
Write-Output "version: LibreOffice $version (buildid $buildId)"
Write-Output "staged size: $size"
Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
Write-Output "Done. engine/lo-bin/ is gitignored; build-release stages it into the deps tar."