@echo off
chcp 65001 >nul
title Đẩy dự án SIGMACAR lên GitHub & Cloudflare Pages (sigma-car)
echo ====================================================================
echo   TỰ ĐỘNG ĐỒNG BỘ: GITHUB (minh-tuan-6/sigma-car) + CLOUDFLARE PAGES
echo ====================================================================
echo.

if exist "%LOCALAPPDATA%\Programs\Git\cmd" (
    set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Programs\Git\mingw64\bin;%PATH%"
)

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] CHƯA TÌM THẤY GIT TRÊN MÁY TÍNH CỦA BẠN.
    pause
    exit /b 1
)

echo [1/4] Chuẩn bị gói dữ liệu xuất bản (build dist)...
call node scripts/build_dist.js

echo [2/4] Kiểm tra Git và remote origin...
if not exist .git (
    git init
)
git remote set-url origin https://github.com/minh-tuan-6/sigma-car.git 2>nul
if %ERRORLEVEL% NEQ 0 (
    git remote add origin https://github.com/minh-tuan-6/sigma-car.git
)
where gh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    gh auth setup-git >nul 2>nul
)
git branch -M main

echo [3/4] Lưu các thay đổi mới nhất (Git Commit & Push)...
git add .
git commit -m "update: sync changes to GitHub and Cloudflare Pages" 2>nul
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo [THÀNH CÔNG GITHUB] Toàn bộ mã nguồn đã cập nhật lên GitHub!
    echo 👉 Xem mã nguồn tại: https://github.com/minh-tuan-6/sigma-car
    echo ====================================================================
) else (
    echo [!] Cảnh báo: Lỗi khi đẩy lên GitHub. Hãy chạy "gh auth login" hoặc đăng nhập Git Credential Manager rồi thử lại.
)

echo.
echo [4/4] Đồng bộ trực tiếp lên Cloudflare Pages (Production URL cố định)...
call npx.cmd --yes wrangler pages deploy ./dist --project-name sigma-car --branch main

echo.
echo ====================================================================
echo [HOÀN TẤT] Website hoạt động 24/7 tại link Production cố định:
echo 👉 https://sigma-car.pages.dev
echo ====================================================================
echo.
pause
