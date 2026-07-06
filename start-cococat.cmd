@echo off
setlocal

set "COCOCAT_REPO_ROOT=%~dp0"
if "%COCOCAT_RESOURCE_ROOT%"=="" set "COCOCAT_RESOURCE_ROOT=%~dp0"
if "%COCOCAT_CONFIG_DIR%"=="" set "COCOCAT_CONFIG_DIR=%APPDATA%\CocoCat"
if "%COCOCAT_DATA_DIR%"=="" set "COCOCAT_DATA_DIR=%LOCALAPPDATA%\CocoCat"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cococat-stack.ps1" start all
if errorlevel 1 (
  echo.
  echo CocoCat stack failed to start. Run scripts\install-windows.ps1 first, then retry.
  pause
  exit /b 1
)

if exist "%~dp0CocoCat.exe" (
  start "" "%~dp0CocoCat.exe"
  exit /b 0
)

if exist "%~dp0apps\console\src-tauri\target\release\cococat.exe" (
  start "" "%~dp0apps\console\src-tauri\target\release\cococat.exe"
  exit /b 0
)

where corepack >nul 2>nul
if errorlevel 1 (
  echo.
  echo Stack is running, but CocoCat.exe was not found and corepack is unavailable.
  echo Open the installed CocoCat app manually, or build Console with: pnpm console:bundle
  pause
  exit /b 0
)

start "CocoCat Console" cmd /c "cd /d ""%~dp0"" && corepack pnpm console:dev"
exit /b 0
