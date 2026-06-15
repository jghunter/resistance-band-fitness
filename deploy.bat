@echo off
REM Run this from the resistance-band-pwa folder after making any code changes.
REM Cloudflare Pages auto-builds from the GitHub repo, so just push — no manual build needed.
cd /d "%~dp0"
git add .
git commit -m "update: %date% %time%"
git push
echo.
echo Done. Cloudflare Pages will rebuild and deploy in ~1-2 minutes.
echo Live at: https://resistance-band-fitness.pages.dev
echo On iPhone: force-quit the app, wait 30 seconds, reopen.
pause
