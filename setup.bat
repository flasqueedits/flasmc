@echo off
title Flasmc Setup
setlocal enabledelayedexpansion

echo ============================================
echo    Flasmc - Minecraft Server Manager
echo    Setup ^& Start Script
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Download from: https://nodejs.org (LTS recommended)
    pause
    exit /b 1
)
echo [OK] Node.js found:
node -v

:: Check Java
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Java not found in PATH
    echo You can install Java 21+ from: https://adoptium.net
) else (
    echo [OK] Java found:
    java -version 2>&1
)

:: Install npm dependencies
echo.
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)
echo [OK] Dependencies installed

:: Create required directories
if not exist "servers" mkdir servers
if not exist "public\media" mkdir public\media
if not exist "logs" mkdir logs

echo.
echo ============================================
echo    Setup complete!
echo.
echo    Choose how to run:
echo    1 - Electron Desktop App (npm start)
echo    2 - Web Browser (npm run web)
echo    3 - Build Windows Installer (exe)
echo    4 - Exit
echo ============================================
echo.

choice /c 1234 /n /m "Select 1/2/3/4: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto build
if errorlevel 2 goto web
if errorlevel 1 goto electron

:electron
echo.
echo [INFO] Killing old Flasmc processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do (
    if not "%%a"=="" taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo [OK] Starting Electron app...
npm start
pause
exit /b 0

:web
echo.
echo [INFO] Killing old Flasmc processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do (
    if not "%%a"=="" taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo [OK] Starting web server...
npm run web
pause
exit /b 0

:build
echo.
echo [INFO] Building Windows Installer...
echo This will create an exe installer in the "release" folder.
call npx electron-builder --win
if %errorlevel% equ 0 (
    echo [OK] Installer built in the "release" folder!
) else (
    echo [ERROR] Build failed
)
pause
exit /b 0
