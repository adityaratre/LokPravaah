@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo LokPravaah - Civic Reporting Platform
echo ==========================================
if not exist ".env" (
  echo Missing .env. Copy .env.example to .env and add your public Supabase URL and anon key.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing npm dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check your internet connection and Node.js/npm setup.
    pause
    exit /b 1
  )
)
echo.
echo Starting LokPravaah. Keep this window open.
call npm run dev
pause
