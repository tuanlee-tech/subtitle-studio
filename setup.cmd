@echo off
rem Cài đặt Subtitle Studio sau khi clone — double-click hoặc chạy: setup.cmd
rem Tương đương `npm run setup` nhưng tự kiểm tra Node trước.
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js ^>= 20.
  echo.
  echo Windows: winget install OpenJS.NodeJS.LTS
  echo hoac tai tu https://nodejs.org
  echo.
  echo Sau khi cai xong, chay lai: setup.cmd
  exit /b 1
)
node scripts/setup.mjs %*
