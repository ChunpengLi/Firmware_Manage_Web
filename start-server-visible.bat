@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

if "%PORT%"=="" set PORT=3000
set HOST=0.0.0.0

echo ========================================
echo PCS Firmware Manage Web Server
echo ========================================
echo.
echo Working directory:
echo %CD%
echo.
echo Server URL:
echo http://localhost:%PORT%
echo.
echo LAN URL:
echo http://YOUR_SERVER_IP:%PORT%
echo.
echo Listen host:
echo %HOST%
echo.
echo Press Ctrl+C to stop this visible server.
echo ========================================
echo.

set "NODE_EXE="
where node >nul 2>nul
if "%ERRORLEVEL%"=="0" set "NODE_EXE=node"

if "%NODE_EXE%"=="" (
  if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
)

if "%NODE_EXE%"=="" (
  if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"
)

if "%NODE_EXE%"=="" (
  echo Node.js was not found on this computer.
  echo.
  echo Please install Node.js LTS first, then run this file again:
  echo https://nodejs.org/
  echo.
  echo During installation, keep "Add to PATH" enabled.
  echo After installation, close this window and double-click this BAT again.
  echo.
  echo Offline option:
  echo Put node.exe in either of these folders:
  echo %~dp0runtime\node.exe
  echo %~dp0node\node.exe
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo node_modules folder was not found.
  echo Installing dependencies now...
  echo.
  where npm.cmd >nul 2>nul
  if not "%ERRORLEVEL%"=="0" (
    echo npm.cmd was not found. Please reinstall Node.js LTS with npm enabled.
    pause
    exit /b 1
  )
  call npm.cmd install
  if not "%ERRORLEVEL%"=="0" (
    echo npm install failed.
    pause
    exit /b 1
  )
  echo.
)

set "OLD_PID="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:PORT; $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }"`) do set "OLD_PID=%%P"

if not "%OLD_PID%"=="" (
  echo Port %PORT% is already in use by process PID %OLD_PID%.
  echo.
  set /p STOP_OLD=Stop this old server and start a new visible one? [Y/N] 
  if /i "!STOP_OLD!"=="Y" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Id %OLD_PID% -Force"
    timeout /t 1 /nobreak >nul
    echo Old server stopped.
    echo.
  ) else (
    echo Startup canceled.
    pause
    exit /b 1
  )
)

:choose_mode
echo.
echo ========================================
echo Select run mode / 请选择运行方式：
echo   [1] Visible window  可见窗口运行（显示此控制台，默认）
echo   [2] Background      后台运行（隐藏此控制台窗口，服务器持续运行）
echo   [3] Cancel          取消启动
echo ========================================
set "RUN_MODE="
set /p RUN_MODE=Enter 1/2/3 and press Enter [1]:
if "!RUN_MODE!"=="" set "RUN_MODE=1"
if "!RUN_MODE!"=="3" (
  echo Startup canceled.
  pause
  exit /b 0
)
if "!RUN_MODE!"=="2" goto run_background
if not "!RUN_MODE!"=="1" (
  echo Invalid choice, please enter 1, 2, or 3.
  goto choose_mode
)

:run_visible
echo.
echo Visible mode. Press Ctrl+C in this window to stop the server.
echo ========================================
echo.
"%NODE_EXE%" server.js
echo.
echo Server stopped or failed to start.
echo Tip: To run hidden in the background next time, choose option [2].
pause
exit /b %ERRORLEVEL%

:run_background
echo.
echo Launching server in background (hidden window)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%NODE_EXE%' -ArgumentList @('server.js') -WorkingDirectory '%CD%' -WindowStyle Hidden"

echo Waiting for server to become ready...
set "WAITED=0"
:wait_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if "!ERRORLEVEL!"=="0" goto ready_ok
set /a WAITED+=1
if !WAITED! GEQ 15 goto ready_fail
timeout /t 1 /nobreak >nul
goto wait_ready

:ready_ok
echo.
echo ========================================
echo  Server is running in the background.
echo  服务器已在后台运行（控制台窗口已隐藏）
echo.
echo    URL:  http://localhost:%PORT%
echo    LAN:  http://YOUR_SERVER_IP:%PORT%
echo.
echo  This window will close in a few seconds.
echo  停止服务器请运行 stop-server.bat
echo ========================================
timeout /t 5 /nobreak >nul
exit /b 0

:ready_fail
echo.
echo The server did not confirm it is listening on port %PORT%.
echo It may have failed to start. Please run in visible mode [1] to see errors,
echo or check server.log / server.err.log.
pause
exit /b 1
