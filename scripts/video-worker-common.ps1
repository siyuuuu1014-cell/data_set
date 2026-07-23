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

    $conda = Get-Command conda -ErrorAction SilentlyContinue
    if ($conda) {
        try {
            $envInfo = ((& $conda.Source env list --json 2>$null) | Out-String | ConvertFrom-Json)
            $yoloEnv = $envInfo.envs | Where-Object { (Split-Path $_ -Leaf) -eq "yolo" } | Select-Object -First 1
            if ($yoloEnv) {
                $condaPython = Join-Path $yoloEnv "python.exe"
                if (Test-Path -LiteralPath $condaPython -PathType Leaf) {
                    return $condaPython
                }
            }
        } catch {
            # Fall through to the active/system interpreter.
        }
    }

    if ($Env:CONDA_PREFIX) {
        $activeCondaPython = Join-Path $Env:CONDA_PREFIX "python.exe"
        if (Test-Path -LiteralPath $activeCondaPython -PathType Leaf) {
            return $activeCondaPython
        }
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    throw "No Python interpreter found. Create workers/video-annotation/.venv or set NUWA_WORKER_PYTHON."
}
