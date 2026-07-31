@echo off
REM Run this from the resistance-band-pwa folder after making any code changes.
REM Cloudflare Pages auto-builds from the GitHub repo, so just push - no manual build needed.
REM
REM 2026-07-31: this script used to print "Done." unconditionally. On 07/31 the
REM push failed ("no upstream branch") and it still reported success, so four
REM commits' worth of work sat unpublished for three days while the dashboard
REM showed a stale build. Every step is now checked, and Cloudflare's PRODUCTION
REM branch is verified before anything is pushed.
setlocal
cd /d "%~dp0"

REM ---- Cloudflare Pages builds the live site from this branch only. Pushing
REM ---- any other branch produces a PREVIEW deployment on a different URL,
REM ---- which looks like nothing happened.
set PROD_BRANCH=main

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set CURRENT=%%B

if not "%CURRENT%"=="%PROD_BRANCH%" (
  echo.
  echo ==========================================================
  echo  NOT ON THE PRODUCTION BRANCH
  echo ==========================================================
  echo  You are on : %CURRENT%
  echo  Live site  : %PROD_BRANCH%
  echo.
  echo  Pushing "%CURRENT%" will NOT update
  echo  https://resistance-band-fitness.pages.dev
  echo.
  echo  To publish, merge into %PROD_BRANCH% first:
  echo      git checkout %PROD_BRANCH%
  echo      git merge %CURRENT%
  echo      deploy.bat
  echo.
  pause
  exit /b 1
)

git add .
if errorlevel 1 goto :failed

REM `git commit` returns 1 when there is nothing staged. That is not an error -
REM it just means the code is already committed and we only need to push.
git commit -m "update: %date% %time%"
if errorlevel 1 echo (nothing new to commit - pushing existing commits)

git push
if errorlevel 1 goto :failed

echo.
echo Pushed. Cloudflare Pages will rebuild and deploy in ~1-2 minutes.
echo Live at: https://resistance-band-fitness.pages.dev
echo On iPhone: force-quit the app, wait 30 seconds, reopen.
echo.
echo Confirm the build at https://dash.cloudflare.com - the newest deployment
echo should carry today's date. If it does not, the deploy did NOT happen.
pause
exit /b 0

:failed
echo.
echo ==========================================================
echo  DEPLOY FAILED - the live site was NOT updated.
echo ==========================================================
echo  Read the git error above. Nothing was published.
echo.
pause
exit /b 1
