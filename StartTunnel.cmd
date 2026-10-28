@echo off
setlocal
cd /d "%~dp0"
title EvoMeme - Cloudflare Tunnel
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-tunnel.ps1"
if errorlevel 1 pause
