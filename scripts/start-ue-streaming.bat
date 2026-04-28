@echo off
setlocal enabledelayedexpansion

:: ────────────────────────────────────────────────────────────────
:: start-ue-streaming.bat
:: Windows CMD script to start the Node.js server with UE5
:: Pixel Streaming support enabled.
:: ────────────────────────────────────────────────────────────────

if "%~1"=="--help" goto :show_help
if "%~1"=="-h" goto :show_help

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   UE5 Local Streaming Runtime — Startup Script      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ── Load .env file ────────────────────────────────────────────
set "ENV_FILE=.env"
if exist "%ENV_FILE%" (
    echo [INFO] Loading environment variables from %ENV_FILE% ...
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        set "LINE=%%A"
        if not "!LINE:~0,1!"=="#" (
            if not "%%A"=="" (
                set "%%A=%%B"
            )
        )
    )
    echo [INFO] Environment variables loaded.
) else (
    echo [WARN] No .env file found. Using existing environment variables.
    echo [WARN] Copy .env.example to .env and configure UE5 paths first.
)

:: ── Validate required UE environment variables ────────────────
set "MISSING="

if not defined UE_EDITOR_PATH (
    echo [ERROR] UE_EDITOR_PATH is not set.
    set "MISSING=1"
)
if not defined UE_PROJECT_PATH (
    echo [ERROR] UE_PROJECT_PATH is not set.
    set "MISSING=1"
)
if not defined UE_MAP_NAME (
    echo [ERROR] UE_MAP_NAME is not set.
    set "MISSING=1"
)

if defined MISSING (
    echo.
    echo [ERROR] Required UE5 environment variables are missing.
    echo         Please set UE_EDITOR_PATH, UE_PROJECT_PATH, and UE_MAP_NAME
    echo         in your .env file or system environment.
    echo.
    echo         Run: start-ue-streaming.bat --help  for details.
    exit /b 1
)

:: ── Display configuration ─────────────────────────────────────
echo [INFO] Configuration:
echo        UE Editor  : %UE_EDITOR_PATH%
echo        Project    : %UE_PROJECT_PATH%
echo        Map        : %UE_MAP_NAME%
if defined UE_RESOLUTION_WIDTH (
    echo        Resolution : %UE_RESOLUTION_WIDTH%x%UE_RESOLUTION_HEIGHT%
) else (
    echo        Resolution : 1920x1080 (default)
)
if defined UE_PIXEL_STREAMING_PORT (
    echo        Streaming  : port %UE_PIXEL_STREAMING_PORT%
) else (
    echo        Streaming  : port 8888 (default)
)
echo.

:: ── Start the Node.js server ──────────────────────────────────
echo [INFO] Starting Node.js server with UE streaming support...
echo.

npx tsx watch --include server/**/* --include shared/**/* --exclude data/**/* --exclude client/**/* --exclude dist/**/* --exclude .git/**/* server/index.ts

exit /b %ERRORLEVEL%

:: ── Help ──────────────────────────────────────────────────────
:show_help
echo.
echo  UE5 Local Streaming Runtime — Startup Script
echo.
echo  Usage:  start-ue-streaming.bat [--help]
echo.
echo  This script loads environment variables from .env, validates
echo  that the required UE5 configuration is present, and starts
echo  the Node.js development server with UE streaming enabled.
echo.
echo  Required environment variables:
echo    UE_EDITOR_PATH           Path to UE5 editor executable
echo    UE_PROJECT_PATH          Path to .uproject file
echo    UE_MAP_NAME              Map/level to load on startup
echo.
echo  Optional environment variables:
echo    UE_RESOLUTION_WIDTH      Render width  (default: 1920)
echo    UE_RESOLUTION_HEIGHT     Render height (default: 1080)
echo    UE_PIXEL_STREAMING_PORT  Signaling port (default: 8888)
echo    UE_EXTRA_ARGS            Additional UE5 args (comma-separated)
echo    UE_STARTUP_TIMEOUT_MS    Max startup timeout (default: 30000)
echo.
echo  Example .env:
echo    UE_EDITOR_PATH=C:\Program Files\Epic Games\UE_5.4\Engine\Binaries\Win64\UnrealEditor.exe
echo    UE_PROJECT_PATH=C:\Projects\MyProject\MyProject.uproject
echo    UE_MAP_NAME=/Game/Maps/MainLevel
echo.
exit /b 0
