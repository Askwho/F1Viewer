@echo off
rem Stops the Pit Wall relay gracefully (closes the feed and saves the recording).
curl -s -o nul -m 5 -X POST http://127.0.0.1:8787/api/shutdown
if errorlevel 1 (echo Pit Wall isn't running.) else (echo Pit Wall stopped.)
timeout /t 3 >nul 2>&1
