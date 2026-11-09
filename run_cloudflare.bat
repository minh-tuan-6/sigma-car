@echo off
chcp 65001 >nul
title Khởi chạy SIGMACAR & Cloudflare Tunnel
echo ====================================================================
echo        KHỞI CHẠY MÁY CHỦ SIGMACAR VÀ ĐƯỜNG DẪN CLOUDFLARE PUBLIC
echo ====================================================================
echo.

echo [1/2] Đang khởi chạy máy chủ Node.js (cổng 3000)...
start /b "" node server.js >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/2] Đang mở Cloudflare Tunnel ra Internet...
echo.
echo ====================================================================
echo 👉 Đường dẫn công khai (Public URL) sẽ xuất hiện bên dưới:
echo ====================================================================
echo.
.\cloudflared.exe tunnel --url http://localhost:3000 --protocol http2

pause
