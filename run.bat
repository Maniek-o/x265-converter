@echo off
REM x265 Converter - Wrapper launcher
REM Delegates startup to PowerShell script to avoid CMD path escaping issues.

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh.exe"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run.ps1"
if errorlevel 1 (
    echo [ERROR] x265 Converter did not start.
    pause
    exit /b 1
)

endlocal
