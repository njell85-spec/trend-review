@echo off
cd /d "%~dp0"
echo Sending report via Gmail + Google Drive...
node send-report.mjs
pause
