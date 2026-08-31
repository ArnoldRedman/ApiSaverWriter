@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo 织章 Windows 构建工具
echo ========================================
echo.

where pwsh.exe >nul 2>&1
if %errorlevel%==0 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
)
set "BUILD_EXIT=%errorlevel%"

echo.
if "%BUILD_EXIT%"=="0" (
    echo 构建成功，以上已列出安装包位置。
) else (
    echo 构建失败，请查看上面的错误信息和 local-releases 中的日志。
)
echo.
pause
exit /b %BUILD_EXIT%
