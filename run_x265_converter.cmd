@echo off
setlocal
cd /d "%~dp0"

REM Backward-compatible launcher. Use run.bat as primary portable entrypoint.
call "%~dp0run.bat"
