@echo off
setlocal
cd /d "%~dp0"

set "PS_CMD=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS_CMD=pwsh"

set "UNRAID_URL=%~1"
if "%UNRAID_URL%"=="" set "UNRAID_URL=http://192.168.10.186:3001"

set "LOG_FILE=%TEMP%\x265_shortcut_unraid_error.log"
if exist "%LOG_FILE%" del /f /q "%LOG_FILE%" >nul 2>nul

"%PS_CMD%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_desktop_shortcut.ps1" -Mode unraid -UnraidUrl "%UNRAID_URL%" 1>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] Nie udalo sie utworzyc skrotu Unraid.
  echo [INFO] Szczegoly bledu:
  if exist "%LOG_FILE%" type "%LOG_FILE%"
  pause
  exit /b 1
)

echo [OK] Skrot Unraid utworzony na pulpicie.
pause
