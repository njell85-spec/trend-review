@echo off
cd /d "%~dp0"
echo Running EM Literature Review - Today's papers...
node src/index.js --days 30 --max 20 --top 5
pause
