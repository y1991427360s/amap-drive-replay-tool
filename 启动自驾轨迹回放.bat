@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8080"
set "URL=http://localhost:%PORT%"

echo 自驾轨迹回放工具
echo.
echo 服务地址：%URL%
echo 关闭这个窗口即可停止服务并释放 %PORT% 端口。
echo 如果端口已被占用，请先关闭之前的服务窗口。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process '%URL%'"
python -m http.server %PORT%

echo.
echo 服务已停止。
pause
