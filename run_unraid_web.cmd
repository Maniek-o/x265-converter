@echo off
REM x265 Converter - Unraid web launcher wrapper

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "APP_URL=%~1"
if "%APP_URL%"=="" set "APP_URL=http://192.168.10.186:3001"

set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh.exe"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run_unraid_web.ps1" -Url "%APP_URL%"
if errorlevel 1 (
    echo [ERROR] Nie udalo sie uruchomic klienta web Unraid.
    pause
    exit /b 1
)

endlocal
