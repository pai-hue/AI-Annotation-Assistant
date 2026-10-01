@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  AI Annotation Assistant - one-click setup
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creating virtual environment...
    py -3 -m venv .venv 2>nul
    if errorlevel 1 python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: failed to create the virtual environment.
        echo Install Python 3.11+ and enable "Add python.exe to PATH", then run this again.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Virtual environment already exists.
)
echo.

echo [2/3] Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r server\requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: dependency installation failed. Check your network and run this again.
    pause
    exit /b 1
)
echo.

echo [3/3] Starting backend at http://127.0.0.1:8000 ...
echo Keep this window open while using the plugin. Press Ctrl+C to stop.
echo.
".venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload

pause
