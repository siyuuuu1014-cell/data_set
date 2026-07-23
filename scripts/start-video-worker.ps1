# nuwa Video Worker — start script
param(
  $Port,
  $BindHost,
  [string]$EnvFile,
  [switch]$Dev  # dev mode: auto-clear cache + hot reload on file changes
)

$Root = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $Root "workers\video-annotation"
. (Join-Path $PSScriptRoot "video-worker-common.ps1")
if (-not $EnvFile) { $EnvFile = Join-Path $WorkerDir "worker.env" }
Import-NuwaWorkerEnv -Path $EnvFile
$Port = if ($null -ne $Port) { $Port } elseif ($Env:WORKER_PORT) { $Env:WORKER_PORT } else { 8765 }
$BindHost = if ($BindHost) { $BindHost } elseif ($Env:WORKER_HOST) { $Env:WORKER_HOST } else { "127.0.0.1" }
$PythonExe = Resolve-NuwaWorkerPython -Root $Root

$Env:PYTHONPATH = $WorkerDir
$Env:WORKER_PORT = $Port
$Env:WORKER_HOST = $BindHost
if (-not $Env:VIDEO_ANNOTATION_DATA_ROOT) {
    $Env:VIDEO_ANNOTATION_DATA_ROOT = Join-Path $Root "data\video-annotations"
}

$portInUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $portInUse) {
    $portInUse = netstat -ano | Select-String -Pattern ":${Port}\s+.*LISTENING"
}
if ($portInUse) {
    throw "Port $Port is already in use. Stop the existing Video Worker before starting another instance."
}

$AuthState = & $PythonExe -c "import sys; sys.path.insert(0, r'$WorkerDir'); from providers.registry import deployment_mode, has_hf_token; print(f'{deployment_mode()}:{str(has_hf_token()).lower()}')" 2>$null
if ($AuthState -eq "enhanced:false") {
    Write-Host "Enhanced mode needs Hugging Face authorization." -ForegroundColor Yellow
    Write-Host "Open the shared Settings page after startup to connect securely." -ForegroundColor Yellow
}

if ($Dev) {
    Write-Host "Clearing Python bytecode cache..." -ForegroundColor Cyan
    Get-ChildItem -Path $WorkerDir -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Starting nuwa Video Worker on port $Port..." -ForegroundColor Green
Write-Host "  Python: $PythonExe" -ForegroundColor Cyan
if ($Dev) { Write-Host "  DEV MODE: auto-reload on file changes" -ForegroundColor Yellow }
Write-Host "  http://${BindHost}:${Port}/health" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray

Push-Location $WorkerDir
try {
    if ($Dev) {
        & $PythonExe -m uvicorn app:app --host $BindHost --port $Port --log-level info --reload
    } else {
        & $PythonExe -c "
import sys; sys.path.insert(0, '.')
from app import app
import uvicorn
uvicorn.run(app, host='$BindHost', port=$Port, log_level='info')
"
    }
} finally {
    Pop-Location
}
