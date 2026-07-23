# nuwa Video Annotation — setup script
# Installs Python dependencies into the conda env used by start scripts

param(
    [ValidateSet("base", "detect", "semantic", "grounding", "ocr", "audio", "depth", "full")]
    [string]$Profile = "full",
    [switch]$DownloadModels,
    [switch]$NoModels = $false
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $Root "workers\video-annotation"
. (Join-Path $PSScriptRoot "video-worker-common.ps1")
Import-NuwaWorkerEnv -Path (Join-Path $WorkerDir "worker.env")
$PythonExe = Resolve-NuwaWorkerPython -Root $Root

Write-Host "=== nuwa Video Worker Setup ===" -ForegroundColor Green

$ver = & $PythonExe --version 2>&1
Write-Host "  Python: $ver ($PythonExe)" -ForegroundColor Green

Write-Host "  Installing Python profile: $Profile" -ForegroundColor Cyan
if ($Profile -eq "base") {
    & $PythonExe -m pip install -e $WorkerDir
} else {
    & $PythonExe -m pip install -e "${WorkerDir}[$Profile]"
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "  Dependencies installed" -ForegroundColor Green

# Create data dirs
$DataDir = Join-Path $Root "data\video-annotations"
foreach ($sub in @("tasks", "uploads", "cache", "exports", "temp")) {
    $d = Join-Path $DataDir $sub
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

if ($DownloadModels -and -not $NoModels) {
    Write-Host "  Downloading models for profile: $Profile" -ForegroundColor Cyan
    Push-Location $WorkerDir
    try {
        & $PythonExe -m nuwa_worker models download --profile $Profile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Setup complete! Run: .\scripts\start-video-worker.ps1" -ForegroundColor Green
