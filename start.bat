@echo off
title Flasmc Launcher
setlocal enabledelayedexpansion

echo ============================================
echo    Flasmc - Launch Everything
echo ============================================
echo.

:: Check if Node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install from https://nodejs.org
    pause
    exit /b 1
)

:: Install deps if needed
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if !errorlevel! neq 0 ( echo [ERROR] npm install failed & pause & exit /b 1 )
)

:: Ensure data dirs
if not exist "servers" mkdir servers
if not exist "public\media" mkdir public\media
if not exist "logs" mkdir logs

:: Kill old processes on ports 3000 and 3001
echo [INFO] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do (
    if not "%%a"=="" taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001"') do (
    if not "%%a"=="" taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Start main server
echo [INFO] Starting main server (port 3000)...
start "Flasmc Server" cmd /c "node server.js"

:: Wait for main server to start
timeout /t 4 /nobreak >nul

:: Start Discord bot app
echo [INFO] Starting Discord Bot App (port 3001)...
start "Flasmc Discord" cmd /c "node discord-app.js"

:: Open browser
timeout /t 2 /nobreak >nul
echo [INFO] Opening browser...
start http://127.0.0.1:3000

echo.
echo ============================================
echo    Flasmc is starting!
echo    Main UI:     http://127.0.0.1:3000
echo    Discord Bot: http://127.0.0.1:3001
echo ============================================
echo.
echo Close this window to keep servers running in background.
echo Use Task Manager to stop Node.js processes.
echo.
pause
