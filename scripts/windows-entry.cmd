@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
title EvoMeme - Control
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.16 or later first.
  pause
  exit /b 1
)
if not exist "node_modules\tsx\dist\loader.mjs" (
  echo Dependencies are missing. Run npm ci once in this project folder.
  pause
  exit /b 1
)
node --import tsx "scripts\windows-launcher.ts" "%~1"
set "_EVO_EXIT=%ERRORLEVEL%"
if not "%_EVO_EXIT%"=="0" pause
if "%_EVO_EXIT%"=="0" if /I not "%~1"=="start" if /I not "%~1"=="public" pause
exit /b %_EVO_EXIT%
