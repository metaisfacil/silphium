param(
    [Parameter(Mandatory = $true)]
    [string]$Ldflags
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $repoRoot 'build/.make-dev.pid'

function Get-ChildProcessIds {
    param([int]$ParentId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue
    if ($null -eq $children) {
        return @()
    }

    return @($children | Select-Object -ExpandProperty ProcessId)
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    foreach ($childId in Get-ChildProcessIds -ParentId $ProcessId) {
        Stop-ProcessTree -ProcessId $childId
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Get-TrackedDevProcess {
    param([int]$ProcessId)

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($process.CommandLine)) {
        return $null
    }

    if ($process.CommandLine -notmatch 'run_dev\.ps1') {
        return $null
    }

    return $process
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pidPath) | Out-Null

if (Test-Path $pidPath) {
    $existingPidText = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($existingPidText -match '^\d+$') {
        $existingPid = [int]$existingPidText
        if ($existingPid -ne $PID) {
            $existingProcess = Get-TrackedDevProcess -ProcessId $existingPid
            if ($null -ne $existingProcess) {
                Write-Host "Stopping previous make dev session (PID $existingPid)"
                Stop-ProcessTree -ProcessId $existingPid
            }
        }
    }

    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}

Set-Content -Path $pidPath -Value $PID -Encoding ascii

$exitCode = 0
Push-Location $repoRoot
try {
    & wails dev -ldflags $Ldflags
    if ($LASTEXITCODE) {
        $exitCode = $LASTEXITCODE
    }
} finally {
    Pop-Location

    if (Test-Path $pidPath) {
        $currentPidText = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
        if ($currentPidText -eq "$PID") {
            Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
        }
    }
}

exit $exitCode