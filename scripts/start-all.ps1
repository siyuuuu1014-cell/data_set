# nuwa — start all (frontend + worker)
param(
    [switch]$Dev,  # dev mode: worker hot reload + frontend `npm run dev`
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
    param($ScriptPath, $Port, $DevMode)
    if ($DevMode) {
        & $ScriptPath -Port $Port -Dev
    } else {
        & $ScriptPath -Port $Port
    }
} -ArgumentList $StartWorkerScript, $WorkerPort, $Dev

Write-Host "  Worker starting on port $WorkerPort..." -ForegroundColor Cyan

# Wait for the worker health endpoint instead of a fixed sleep
$healthUrl = "http://127.0.0.1:${WorkerPort}/health"
$healthy = $false
$attempts = 0
$maxAttempts = 30
while ($attempts -lt $maxAttempts) {
    $attempts++
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') {
            $healthy = $true
            break
        }
    } catch {
        # Worker not up yet — retry
    }
    Start-Sleep -Seconds 1
}
if ($healthy) {
    Write-Host "  Worker healthy on port $WorkerPort." -ForegroundColor Green
} else {
    Write-Host "  WARNING: Worker did not become healthy within $maxAttempts seconds." -ForegroundColor Yellow
    Write-Host "  The frontend may return transient 503 errors while the Worker finishes starting." -ForegroundColor Yellow
}

# Start frontend
Write-Host "  Frontend starting on port $FrontendPort..." -ForegroundColor Cyan
Push-Location $Root
try {
    if ($Dev) {
        npm run dev
    } else {
        npm run build; if ($?) { npm run start }
    }
} finally {
    Pop-Location
    Stop-Job -Name "nuwa-worker" -ErrorAction SilentlyContinue
    Remove-Job -Name "nuwa-worker" -ErrorAction SilentlyContinue
}
