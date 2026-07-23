# nuwa Video Worker — environment check

$ErrorActionPreference = "Continue"

Write-Host "=== nuwa Video Worker Environment Check ===" -ForegroundColor Green
Write-Host ""

# Python (same resolver used by setup/start scripts)
Write-Host "Python:" -ForegroundColor Cyan
$Root = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $Root "workers\video-annotation"
. (Join-Path $PSScriptRoot "video-worker-common.ps1")
try {
    Import-NuwaWorkerEnv -Path (Join-Path $WorkerDir "worker.env")
    $py = Resolve-NuwaWorkerPython -Root $Root
    & $py --version
    Write-Host "  Path: $py" -ForegroundColor Green
    Push-Location $WorkerDir
    try { & $py -m nuwa_worker doctor } finally { Pop-Location }
} catch {
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
}

# CUDA
Write-Host ""
Write-Host "CUDA:" -ForegroundColor Cyan
$nvccCommand = Get-Command nvcc -ErrorAction SilentlyContinue
$nvcc = if ($nvccCommand) { $nvccCommand.Source } else { $null }
if ($nvcc) {
    & nvcc --version | Select-Object -First 1
} else {
    Write-Host "  nvcc not in PATH (may still be available via PyTorch)" -ForegroundColor Yellow
}
$nvidiaSmiCommand = Get-Command nvidia-smi -ErrorAction SilentlyContinue
$nvidiaSmi = if ($nvidiaSmiCommand) { $nvidiaSmiCommand.Source } else { $null }
if ($nvidiaSmi) {
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
} else {
    Write-Host "  nvidia-smi not found — GPU may not be available" -ForegroundColor Yellow
}

# FFmpeg
Write-Host ""
Write-Host "FFmpeg:" -ForegroundColor Cyan
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if ($ffmpeg) { Write-Host "  ffmpeg: $($ffmpeg.Source)" -ForegroundColor Green } else { Write-Host "  ffmpeg NOT FOUND" -ForegroundColor Red }
if ($ffprobe) { Write-Host "  ffprobe: $($ffprobe.Source)" -ForegroundColor Green } else { Write-Host "  ffprobe NOT FOUND" -ForegroundColor Red }

# Ports
Write-Host ""
Write-Host "Ports:" -ForegroundColor Cyan
$ports = @(3000, 8765)
foreach ($p in $ports) {
    $inUse = (Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue).Count
    if ($inUse -gt 0) {
        Write-Host "  Port $p - IN USE" -ForegroundColor Yellow
    } else {
        Write-Host "  Port $p - free" -ForegroundColor Green
    }
}

# Disk
Write-Host ""
Write-Host "Disk:" -ForegroundColor Cyan
$driveRoot = [System.IO.Path]::GetPathRoot($Root)
$disk = [System.IO.DriveInfo]::new($driveRoot)
$freeGB = [math]::Round($disk.AvailableFreeSpace / 1GB, 1)
Write-Host "  Free: ${freeGB} GB (recommend > 20GB for models)" -ForegroundColor $(if ($freeGB -gt 20) { "Green" } else { "Yellow" })
