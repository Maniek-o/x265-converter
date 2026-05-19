@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Fetch + pull from GitHub...
git fetch --prune origin
if errorlevel 1 goto :err
git pull --ff-only origin main
if errorlevel 1 goto :err

echo [2/5] Install/update npm dependencies...
call npm.cmd ci --omit=dev
if errorlevel 1 goto :err

echo [3/5] Recreate LOCAL desktop shortcut...
call "%~dp0create_desktop_shortcut.cmd"
if errorlevel 1 goto :err

echo [4/5] Verify current commit...
git rev-parse --short HEAD

echo [5/5] Done.
echo Local portable is synced with GitHub and shortcut points to local app.
goto :ok

:err
echo [ERROR] Update failed.
exit /b 1

:ok
exit /b 0
