@echo off
setlocal
cd /d "%~dp0"

set "PS_CMD=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS_CMD=pwsh"

set "LOG_FILE=%TEMP%\x265_shortcut_error.log"
if exist "%LOG_FILE%" del /f /q "%LOG_FILE%" >nul 2>nul

"%PS_CMD%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_desktop_shortcut.ps1" 1>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] Nie udalo sie utworzyc skrotu.
  echo [INFO] Szczegoly bledu:
  if exist "%LOG_FILE%" type "%LOG_FILE%"
  pause
  exit /b 1
)

echo [OK] Skrot utworzony na pulpicie.
pause
