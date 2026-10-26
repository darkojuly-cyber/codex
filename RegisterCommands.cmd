@echo off
setlocal
cd /d "%~dp0"
title EvoMeme - Register Discord commands
set APP_MODE=discord
set DISCORD_WRITES_ENABLED=true
call npm run bot:register
pause
