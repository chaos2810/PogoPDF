# Fetch the tesseract language .traineddata files used by the ocr tool into
# engine/ocr-data/ for development. Only the 8 languages in OcrInputSchema's
# enum are downloaded, so the engine can run OCR fully offline: tesseract.js is
# given a local langPath and never reaches its default jsdelivr CDN.
#
# The "fast" tessdata repository (tesseract-ocr/tessdata_fast) is used rather
# than the larger "best" repository: the fast variants are ~1-10 MB each and
# are the LSTM-only models, which is what tesseract.js 7 loads by default
# (OEM.LSTM_ONLY). The full 8 language set is well under 100 MB, small enough
# to vendor. The URL is the GitHub "raw" endpoint, which redirects to
# raw.githubusercontent.com; both are stable for a given branch.
#
# Release builds do not use this script; build-release.ps1 stages the same
# directory into engine-deps.tar.
#
#   powershell engine/scripts/fetch-ocr-data.ps1 [-Force]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Must stay in sync with the OcrInputSchema language enum in
# packages/contracts/src/tools.ts.
$langs = @("eng", "chi_tra", "chi_sim", "jpn", "kor", "deu", "fra", "spa")
$baseUrl = "https://github.com/tesseract-ocr/tessdata_fast/raw/main"

$dataDir = Join-Path $PSScriptRoot "..\ocr-data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$total = 0
$downloaded = 0
foreach ($lang in $langs) {
    $dest = Join-Path $dataDir "$lang.traineddata"
    $url = "$baseUrl/$lang.traineddata"

    if ((Test-Path $dest) -and -not $Force) {
        $size = (Get-Item $dest).Length
        Write-Output "$lang`: cached, $size bytes"
    }
    else {
        Write-Output "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        $downloaded++
        Write-Output "$lang`: downloaded, $((Get-Item $dest).Length) bytes"
    }

    $sha = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
    Write-Output "  sha256: $sha"
    $total += (Get-Item $dest).Length
}

Write-Output ""
Write-Output "ocr-data: $($langs.Count) language file(s), $total total bytes, $downloaded downloaded"
