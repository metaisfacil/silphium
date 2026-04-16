param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceExe = Join-Path $repoRoot 'build/bin/Silphium.exe'
$sourceSettings = Join-Path $repoRoot 'build/bin/silphium.settings.json'
$clientDir = Join-Path $repoRoot 'build/test-client'
$clientExe = Join-Path $clientDir 'Silphium.exe'
$clientSettingsPath = Join-Path $clientDir 'silphium.settings.json'

if (-not (Test-Path $sourceExe)) {
    throw "Missing built executable at $sourceExe. Run 'make build' first."
}

if (-not (Test-Path $sourceSettings)) {
    throw "Missing source settings at $sourceSettings. Launch the main app once and configure library sharing first."
}

$sourceSettingsJson = Get-Content $sourceSettings -Raw | ConvertFrom-Json
$sharingPasswordHash = [string]$sourceSettingsJson.librarySharingPasswordHash
$sharingPort = [int]$sourceSettingsJson.librarySharingPort
if ($sharingPort -le 0) {
    $sharingPort = 41637
}

if ([string]::IsNullOrWhiteSpace($sharingPasswordHash)) {
    throw "The main instance does not have a library sharing password hash configured. Set a share password in Settings first."
}

New-Item -ItemType Directory -Force -Path $clientDir | Out-Null
Copy-Item -Path $sourceExe -Destination $clientExe -Force

$clientSettings = [ordered]@{
    libraryFolders                      = @(
        [ordered]@{
            path         = "silphium-remote://127.0.0.1:$sharingPort"
            kind         = 'remote'
            host         = '127.0.0.1'
            port         = $sharingPort
            label        = 'Local Share Test'
            passwordHash = $sharingPasswordHash
            releaseDepth = 4
        }
    )
    libraryPath                         = "silphium-remote://127.0.0.1:$sharingPort"
    remoteLibraryTranscodingEnabled     = $true
    remoteLibraryTranscodingBitrateKbps = 192
    librarySharingEnabled               = $false
    playbackOrder                       = 'ordered-library'
    coverArtPriority                    = @('file', 'embedded')
    audio                               = [ordered]@{
        outputDevice      = 'default'
        gaplessPlayback   = $true
        replayGainEnabled = $true
    }
    keyboardShortcuts                   = [ordered]@{
        playPauseToggle    = 'Space'
        nextTrack          = 'N'
        previousTrack      = 'P'
        stopPlayback       = 'Z'
        focusLibraryFilter = 'Ctrl+F'
        openSettings       = 'Ctrl+P'
    }
}

$clientSettings | ConvertTo-Json -Depth 8 | Set-Content -Path $clientSettingsPath -Encoding utf8

Start-Process -FilePath $clientExe -WorkingDirectory $clientDir | Out-Null
Write-Host "Test client launched from $clientDir"