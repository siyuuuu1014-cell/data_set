function Import-NuwaWorkerEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            throw "Invalid worker environment line in ${Path}: $line"
        }
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($value -and -not (Test-Path "Env:$name")) {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

function Resolve-NuwaWorkerPython {
    param([Parameter(Mandatory = $true)][string]$Root)

    if ($Env:NUWA_WORKER_PYTHON) {
        $explicit = [System.IO.Path]::GetFullPath($Env:NUWA_WORKER_PYTHON)
        if (-not (Test-Path -LiteralPath $explicit -PathType Leaf)) {
            throw "NUWA_WORKER_PYTHON does not exist: $explicit"
        }
        return $explicit
    }

    $venvPython = Join-Path $Root "workers\video-annotation\.venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        return $venvPython
    }

    throw @"
Nuwa's isolated Video Worker environment is missing:
  $venvPython

Run .\scripts\setup-video-worker.ps1 to create it, or explicitly set
NUWA_WORKER_PYTHON to another Nuwa-only interpreter. The launcher will not
fall back to a shared Conda/base environment because changing Worker
dependencies there could break other projects.
"@
}
