<#
.SYNOPSIS
    Starts the Node.js server with UE5 Pixel Streaming support.

.DESCRIPTION
    This script loads environment variables from .env, validates that
    the required UE5 configuration is present, and starts the Node.js
    development server with UE streaming enabled.

.PARAMETER Help
    Show this help message.

.EXAMPLE
    .\scripts\start-ue-streaming.ps1
    .\scripts\start-ue-streaming.ps1 -Help
#>

[CmdletBinding()]
param(
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ──────────────────────────────────────────────────────────
if ($Help) {
    Write-Host ""
    Write-Host "  UE5 Local Streaming Runtime — Startup Script (PowerShell)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Usage:  .\scripts\start-ue-streaming.ps1 [-Help]"
    Write-Host ""
    Write-Host "  This script loads environment variables from .env, validates"
    Write-Host "  that the required UE5 configuration is present, and starts"
    Write-Host "  the Node.js development server with UE streaming enabled."
    Write-Host ""
    Write-Host "  Required environment variables:" -ForegroundColor Yellow
    Write-Host "    UE_EDITOR_PATH           Path to UE5 editor executable"
    Write-Host "    UE_PROJECT_PATH          Path to .uproject file"
    Write-Host "    UE_MAP_NAME              Map/level to load on startup"
    Write-Host ""
    Write-Host "  Optional environment variables:" -ForegroundColor Yellow
    Write-Host "    UE_RESOLUTION_WIDTH      Render width  (default: 1920)"
    Write-Host "    UE_RESOLUTION_HEIGHT     Render height (default: 1080)"
    Write-Host "    UE_PIXEL_STREAMING_PORT  Signaling port (default: 8888)"
    Write-Host "    UE_EXTRA_ARGS            Additional UE5 args (comma-separated)"
    Write-Host "    UE_STARTUP_TIMEOUT_MS    Max startup timeout (default: 30000)"
    Write-Host ""
    Write-Host "  Example .env:" -ForegroundColor Yellow
    Write-Host "    UE_EDITOR_PATH=C:\Program Files\Epic Games\UE_5.4\Engine\Binaries\Win64\UnrealEditor.exe"
    Write-Host "    UE_PROJECT_PATH=C:\Projects\MyProject\MyProject.uproject"
    Write-Host "    UE_MAP_NAME=/Game/Maps/MainLevel"
    Write-Host ""
    exit 0
}

# ── Banner ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   UE5 Local Streaming Runtime — Startup Script      ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Load .env file ────────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot ".." ".env"
if (Test-Path $envFile) {
    Write-Host "[INFO] Loading environment variables from .env ..." -ForegroundColor Green
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        # Skip empty lines and comments
        if ($line -and -not $line.StartsWith("#")) {
            $eqIndex = $line.IndexOf("=")
            if ($eqIndex -gt 0) {
                $key = $line.Substring(0, $eqIndex).Trim()
                $value = $line.Substring($eqIndex + 1).Trim()
                [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
    Write-Host "[INFO] Environment variables loaded." -ForegroundColor Green
} else {
    Write-Host "[WARN] No .env file found. Using existing environment variables." -ForegroundColor Yellow
    Write-Host "[WARN] Copy .env.example to .env and configure UE5 paths first." -ForegroundColor Yellow
}

# ── Validate required UE environment variables ────────────────────
$missing = @()

$ueEditorPath = [System.Environment]::GetEnvironmentVariable("UE_EDITOR_PATH", "Process")
$ueProjectPath = [System.Environment]::GetEnvironmentVariable("UE_PROJECT_PATH", "Process")
$ueMapName = [System.Environment]::GetEnvironmentVariable("UE_MAP_NAME", "Process")

if (-not $ueEditorPath) { $missing += "UE_EDITOR_PATH" }
if (-not $ueProjectPath) { $missing += "UE_PROJECT_PATH" }
if (-not $ueMapName) { $missing += "UE_MAP_NAME" }

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "[ERROR] Required UE5 environment variables are missing:" -ForegroundColor Red
    foreach ($var in $missing) {
        Write-Host "        - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "        Please set these in your .env file or system environment." -ForegroundColor Red
    Write-Host "        Run: .\scripts\start-ue-streaming.ps1 -Help  for details." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ── Display configuration ─────────────────────────────────────────
$resWidth = [System.Environment]::GetEnvironmentVariable("UE_RESOLUTION_WIDTH", "Process")
$resHeight = [System.Environment]::GetEnvironmentVariable("UE_RESOLUTION_HEIGHT", "Process")
$streamPort = [System.Environment]::GetEnvironmentVariable("UE_PIXEL_STREAMING_PORT", "Process")

Write-Host "[INFO] Configuration:" -ForegroundColor Green
Write-Host "       UE Editor  : $ueEditorPath"
Write-Host "       Project    : $ueProjectPath"
Write-Host "       Map        : $ueMapName"

if ($resWidth -and $resHeight) {
    Write-Host "       Resolution : ${resWidth}x${resHeight}"
} else {
    Write-Host "       Resolution : 1920x1080 (default)"
}

if ($streamPort) {
    Write-Host "       Streaming  : port $streamPort"
} else {
    Write-Host "       Streaming  : port 8888 (default)"
}

Write-Host ""

# ── Start the Node.js server ──────────────────────────────────────
Write-Host "[INFO] Starting Node.js server with UE streaming support..." -ForegroundColor Green
Write-Host ""

$serverRoot = Join-Path $PSScriptRoot ".."
Push-Location $serverRoot
try {
    & npx tsx watch --include "server/**/*" --include "shared/**/*" --exclude "data/**/*" --exclude "client/**/*" --exclude "dist/**/*" --exclude ".git/**/*" server/index.ts
} finally {
    Pop-Location
}
