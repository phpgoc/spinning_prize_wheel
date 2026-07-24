@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web-launcher.ps1"
if errorlevel 1 pause
