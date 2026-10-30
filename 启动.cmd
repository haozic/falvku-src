@echo off
chcp 65001 >nul
title 法律法规库 · 本地服务
cd /d "%~dp0"

echo.
echo   ============================================
echo      法律法规库 - 本地服务启动中
echo   ============================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    echo   [1/2] 启动静态服务器 http://127.0.0.1:8765
    start "" http://127.0.0.1:8765/index.html
    python -m http.server 8765 --bind 127.0.0.1
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    echo   [1/2] 启动静态服务器 http://127.0.0.1:8765
    start "" http://127.0.0.1:8765/index.html
    py -m http.server 8765 --bind 127.0.0.1
    goto :eof
)

echo   未检测到 Python，直接以浏览器打开本地页面即可：
echo.
echo     %~dp0index.html
echo.
echo   (双击即可使用，法规数据已内置于页面中)
start "" "%~dp0index.html"
pause
