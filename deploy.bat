@echo off
REM Run this from the resistance-band-pwa folder after making any code changes.
REM Netlify auto-builds from source, so just push — no manual build needed.
cd /d "%~dp0"
git add .
git commit -m "update: %date% %time%"
git push
echo.
echo Done. Netlify will rebuild and deploy in ~1-2 minutes.
echo On iPhone: force-quit the app, wait 30 seconds, reopen.
pause
