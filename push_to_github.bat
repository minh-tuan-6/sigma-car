@echo off
chcp 65001 >nul
title Đẩy dự án SIGMACAR lên GitHub (minh-tuan-6/sigma-car)
echo ====================================================================
echo        TỰ ĐỘNG ĐẨY MÃ NGUỒN LÊN GITHUB: minh-tuan-6/sigma-car
echo ====================================================================
echo.

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] CHƯA TÌM THẤY GIT TRÊN MÁY TÍNH CỦA BẠN.
    echo.
    echo Vui lòng tải và cài đặt Git theo 1 trong 2 cách:
    echo 1. Tải bộ cài chính thức tại: https://git-scm.com/download/win
    echo 2. Hoặc nếu bạn đã tải file cài đặt, hãy nhấp đúp để cài đặt (Next ^> Next ^> Finish).
    echo.
    echo Sau khi cài đặt xong Git, hãy chạy lại file này!
    echo ====================================================================
    pause
    exit /b 1
)

echo [1/5] Khởi tạo Git repository...
if not exist .git (
    git init
)

echo [2/5] Cấu hình remote GitHub: https://github.com/minh-tuan-6/sigma-car.git ...
git remote remove origin 2>nul
git remote add origin https://github.com/minh-tuan-6/sigma-car.git
git branch -M main

echo [3/5] Thêm toàn bộ mã nguồn vào vùng chuẩn bị (staging)...
git add .

echo [4/5] Tạo commit dự án...
git commit -m "Upload SIGMACAR E-Commerce Platform - Nhap mon CNTT"

echo [5/5] Đang đẩy (Push) lên GitHub...
echo (Nếu có cửa sổ trình duyệt bật lên, hãy bấm 'Sign in with browser' / 'Authorize' để xác thực tài khoản nhé)
echo.
git push -u origin main --force

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo [THÀNH CÔNG] Toàn bộ mã nguồn đã được đưa lên GitHub thành công!
    echo 👉 Xem mã nguồn tại: https://github.com/minh-tuan-6/sigma-car
    echo ====================================================================
) else (
    echo.
    echo [!] Có lỗi xảy ra trong quá trình push. Vui lòng kiểm tra quyền đăng nhập GitHub.
)

pause
