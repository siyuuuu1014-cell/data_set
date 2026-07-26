# nuwa Video Annotation — setup script
# Creates a project-local virtual environment and installs Worker dependencies.

param(
    [ValidateSet("base", "detect", "semantic", "grounding", "ocr", "audio", "depth", "full")]
    [string]$Profile = "full",
    [switch]$DownloadModels,
    [switch]$NoModels = $false,
    [string]$BootstrapPython,
    [string]$TorchIndexUrl,
    [string]$TorchVersion,
    [string]$TorchvisionVersion
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $Root "workers\video-annotation"
$VenvDir = Join-Path $WorkerDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
. (Join-Path $PSScriptRoot "video-worker-common.ps1")
Import-NuwaWorkerEnv -Path (Join-Path $WorkerDir "worker.env")
$TorchIndexUrl = if ($TorchIndexUrl) { $TorchIndexUrl } else { $Env:NUWA_TORCH_INDEX_URL }
$TorchVersion = if ($TorchVersion) { $TorchVersion } elseif ($Env:NUWA_TORCH_VERSION) { $Env:NUWA_TORCH_VERSION } else { "2.13.0+cu132" }
$TorchvisionVersion = if ($TorchvisionVersion) { $TorchvisionVersion } elseif ($Env:NUWA_TORCHVISION_VERSION) { $Env:NUWA_TORCHVISION_VERSION } else { "0.28.0+cu132" }

Write-Host "=== nuwa Video Worker Setup ===" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    if ($BootstrapPython) {
        $BootstrapPython = [System.IO.Path]::GetFullPath($BootstrapPython)
        if (-not (Test-Path -LiteralPath $BootstrapPython -PathType Leaf)) {
            throw "Bootstrap Python does not exist: $BootstrapPython"
        }
    } else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) {
            throw "No bootstrap Python found. Pass -BootstrapPython with an existing python.exe."
        }
        $BootstrapPython = $pythonCommand.Source
    }

    Write-Host "  Creating isolated environment: $VenvDir" -ForegroundColor Cyan
    Write-Host "  Bootstrap Python: $BootstrapPython" -ForegroundColor Cyan
    & $BootstrapPython -m venv $VenvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
        throw "Failed to create Nuwa's isolated Worker environment."
    }
}

$ver = & $PythonExe --version 2>&1
Write-Host "  Python: $ver ($PythonExe)" -ForegroundColor Green

if ($Profile -in @("detect", "semantic", "grounding", "audio", "depth", "full") -and $TorchIndexUrl) {
    Write-Host "  Installing the configured GPU build of PyTorch" -ForegroundColor Cyan
    & $PythonExe -m pip install --upgrade `
        "torch==$TorchVersion" "torchvision==$TorchvisionVersion" `
        --index-url $TorchIndexUrl
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

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
