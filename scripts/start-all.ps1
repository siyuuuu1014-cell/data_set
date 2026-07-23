# nuwa — start all (frontend + worker)
param(
    $WorkerPort,
    $FrontendPort = 3000
)

$Root = Split-Path -Parent $PSScriptRoot
$StartWorkerScript = Join-Path $PSScriptRoot "start-video-worker.ps1"
. (Join-Path $PSScriptRoot "video-worker-common.ps1")
Import-NuwaWorkerEnv -Path (Join-Path $Root "workers\video-annotation\worker.env")
$WorkerPort = if ($null -ne $WorkerPort) { $WorkerPort } elseif ($Env:WORKER_PORT) { $Env:WORKER_PORT } else { 8765 }

Write-Host "=== nuwa — Starting All Services ===" -ForegroundColor Green

# Start worker in background
$WorkerJob = Start-Job -Name "nuwa-worker" -ScriptBlock {
    param($ScriptPath, $Port)
    & $ScriptPath -Port $Port
} -ArgumentList $StartWorkerScript, $WorkerPort

Write-Host "  Worker starting on port $WorkerPort..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

# Start frontend
Write-Host "  Frontend starting on port $FrontendPort..." -ForegroundColor Cyan
Push-Location $Root
try {
    npm run dev
} finally {
    Pop-Location
    Stop-Job -Name "nuwa-worker" -ErrorAction SilentlyContinue
    Remove-Job -Name "nuwa-worker" -ErrorAction SilentlyContinue
}
