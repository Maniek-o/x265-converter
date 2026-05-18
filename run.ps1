#!/usr/bin/env pwsh
# x265 Converter - Portable Launcher (PowerShell)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "x265 Converter - Starting Application" -ForegroundColor Cyan

function Stop-WithMessage([string]$Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Test-BackendHealth {
    try {
        $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 2
        return [bool]$resp.ok
    } catch {
        return $false
    }
}

function Wait-BackendHealth([int]$TimeoutSeconds = 20) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-BackendHealth) {
            return $true
        }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Start-WebFallback {
    Write-Host "Electron failed, switching to web mode..." -ForegroundColor Yellow

    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Stop-WithMessage "ERROR: node.exe is not available in PATH."
    }

    $serverPath = Join-Path $ScriptDir 'server.js'
    if (-not (Test-Path -LiteralPath $serverPath)) {
        Stop-WithMessage "ERROR: Missing server.js in project folder."
    }

    $quotedServerPath = '"' + $serverPath + '"'
    Start-Process -FilePath $nodeCmd.Source -ArgumentList @($quotedServerPath) -WorkingDirectory $ScriptDir -WindowStyle Hidden | Out-Null

    if (-not (Wait-BackendHealth 20)) {
        Stop-WithMessage "ERROR: Web fallback could not start backend on http://127.0.0.1:3001"
    }

    Start-Process 'http://127.0.0.1:3001'
    Write-Host "Web mode started at http://127.0.0.1:3001" -ForegroundColor Green
    exit 0
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "ERROR: npm.cmd is not available in PATH. Install Node.js LTS and try again: https://nodejs.org/"
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage "ERROR: Dependency installation failed."
    }
}

$electronExe = Join-Path $ScriptDir 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
    Write-Host "Repairing Electron package..." -ForegroundColor Yellow
    & npm.cmd install
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $electronExe)) {
        Stop-WithMessage "ERROR: Electron binary is missing after install."
    }
}

# Try to free port 3001 from stale process before launching.
try {
    $pids = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        if ($pid -and $pid -ne $PID) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    # If net cmdlets are unavailable, continue without port cleanup.
}

Write-Host "Launching x265 Converter..." -ForegroundColor Green
try {
    # Start Electron as a desktop process and verify it stays alive briefly.
    # This avoids false fallback when PowerShell reports a stale $LASTEXITCODE.
    # Keep the app path in one argument even with spaces/caret (e.g. C:\^ Claud\...).
    $quotedScriptDir = '"' + $ScriptDir + '"'
    $electronProcess = Start-Process -FilePath $electronExe -ArgumentList @($quotedScriptDir) -WorkingDirectory $ScriptDir -PassThru
    Start-Sleep -Milliseconds 1500

    if ($electronProcess.HasExited) {
        if ($electronProcess.ExitCode -ne 0) {
            Start-WebFallback
        }

        Stop-WithMessage "ERROR: Electron zamknął się natychmiast (kod: $($electronProcess.ExitCode))."
    }

    Write-Host "Desktop mode started." -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Electron failed, switching to web mode..." -ForegroundColor Yellow
    Start-WebFallback
}
