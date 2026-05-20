#!/usr/bin/env pwsh
# x265 Converter - Unraid Web Launcher

param(
    [string]$Url = 'http://192.168.10.186:3001'
)

$ErrorActionPreference = 'Stop'

try {
    if (-not $Url.StartsWith('http://') -and -not $Url.StartsWith('https://')) {
        throw "Nieprawidlowy URL: $Url"
    }

    Write-Host "x265 Converter - Unraid Web Client" -ForegroundColor Cyan

    $chosenUrl = $Url
    $healthOk = $false
    try {
        $healthUrl = $chosenUrl.TrimEnd('/') + '/api/health'
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
        if ($health.ok) {
            $healthOk = $true
        }
    } catch {
        # continue and open URL anyway
    }

    if (-not $healthOk) {
        Write-Host "Uwaga: backend nie odpowiada na /api/health. Otwieram URL mimo to." -ForegroundColor Yellow
    }

    Write-Host "Otwieram: $chosenUrl" -ForegroundColor Green
    Start-Process $chosenUrl
} catch {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
