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
    Write-Host "Otwieram: $Url" -ForegroundColor Green

    try {
        $healthUrl = $Url.TrimEnd('/') + '/api/health'
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
        if (-not $health.ok) {
            Write-Host "Uwaga: backend odpowiedzial nieoczekiwanie." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Uwaga: brak odpowiedzi z backendu. Mimo to otwieram aplikacje web." -ForegroundColor Yellow
    }

    Start-Process $Url
} catch {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
