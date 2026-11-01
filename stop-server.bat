@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

if "%PORT%"=="" set PORT=3000

echo ========================================
echo Stop PCS Firmware Manage Web Server
echo ========================================
echo.
echo Looking for a server listening on port %PORT% ...

set "PID_TO_KILL="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }"`) do set "PID_TO_KILL=%%P"

if "!PID_TO_KILL!"=="" (
  echo No server found listening on port %PORT%. Nothing to stop.
  echo.
  pause
  exit /b 0
)

echo Found server process PID !PID_TO_KILL! on port %PORT%.
echo.
set "CONFIRM="
set /p CONFIRM=Stop this server? [Y/N]:
if /i not "!CONFIRM!"=="Y" (
  echo Canceled.
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Id !PID_TO_KILL! -Force"
timeout /t 1 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>nul
if "!ERRORLEVEL!"=="0" (
  echo.
  echo Server stopped. Port %PORT% is now free.
) else (
  echo.
  echo Process was asked to stop, but port %PORT% is still in use.
  echo It may be held by another program.
)

echo.
pause
