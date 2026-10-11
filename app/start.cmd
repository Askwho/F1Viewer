@echo off
rem Pit Wall relay: connects to F1 live timing and serves the dashboard on port 8787.
rem Stop it with stop.cmd, Ctrl+C, or by closing this window. All three save the recording cleanly.
title Pit Wall
cd /d "%~dp0"
curl -s -o nul -m 2 http://127.0.0.1:8787/api/status && (
  echo Pit Wall is already running. Run stop.cmd first if you want to restart it.
  timeout /t 5 >nul 2>&1
  exit /b
)
if not exist dist\index.html call npm run build
node server\index.ts %*
