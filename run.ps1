<#
.SYNOPSIS
    Run the complete Audio Illusion Laboratory project (backend + frontend).

.DESCRIPTION
    One-shot launcher that:
      1. Creates the backend Python venv (backend/.venv) and installs
         requirements.txt on first run.
      2. Installs frontend npm dependencies on first run and seeds .env.local.
      3. Starts the FastAPI backend (uvicorn, port 8000) and the Next.js
         frontend (port 3000), each in its own window.
      4. Waits for the backend, then opens the app in your browser.

    Close the two spawned windows (or press Ctrl+C in them) to stop the servers.

.PARAMETER SkipInstall
    Skip dependency installation (venv pip + npm install), use once everything
    is already installed for a faster start.

.PARAMETER BackendPort
    Port for the FastAPI backend (default 8000).

.PARAMETER FrontendPort
    Port for the Next.js dev server (default 3000).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\run.ps1

.EXAMPLE
    .\run.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [switch] $SkipInstall,
    [int]    $BackendPort = 8000,
    [int]    $FrontendPort = 3000
)

$ErrorActionPreference = 'Stop'

# Resolve paths relative to this script so it works from any working directory.
$Root     = $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Audio Illusion Laboratory - launcher" -ForegroundColor White
Write-Host "  ------------------------------------" -ForegroundColor DarkGray

# --- Sanity: project layout -------------------------------------------------
if (-not (Test-Path $Backend))  { throw "backend/ not found next to run.ps1 ($Backend)" }
if (-not (Test-Path $Frontend)) { throw "frontend/ not found next to run.ps1 ($Frontend)" }

# --- Create the backend venv with whatever Python launcher is available ------
function New-BackendVenv {
    param([Parameter(Mandatory)][string] $VenvDir)
    if (Get-Command python -ErrorAction SilentlyContinue) {
        & python --version 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) { & python -m venv $VenvDir; return }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $VenvDir
        return
    }
    throw "Python 3.10+ was not found on PATH. Install it from https://python.org and retry."
}

# --- Resolve npm (prefer npm.cmd so Start-Process can launch it) -------------
function Resolve-Npm {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "npm was not found on PATH. Install Node.js 18+ from https://nodejs.org and retry."
}

# ===========================================================================
# 1. Backend setup
# ===========================================================================
Write-Step "Backend: preparing virtual environment"

$VenvDir    = Join-Path $Backend '.venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'

if (-not (Test-Path $VenvPython)) {
    Write-Warn2 "Creating venv at backend\.venv (first run)..."
    New-BackendVenv -VenvDir $VenvDir
    if (-not (Test-Path $VenvPython)) { throw "Failed to create the virtual environment." }
} else {
    Write-Ok "venv already present."
}

if (-not $SkipInstall) {
    Write-Warn2 "Installing backend dependencies (pip)..."
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r (Join-Path $Backend 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "pip install failed." }
    Write-Ok "Backend dependencies installed."
} else {
    Write-Warn2 "Skipping backend pip install (-SkipInstall)."
}

# ===========================================================================
# 2. Frontend setup
# ===========================================================================
Write-Step "Frontend: preparing Node dependencies"

$Npm        = Resolve-Npm
$NodeModules = Join-Path $Frontend 'node_modules'

if (-not $SkipInstall) {
    if (-not (Test-Path $NodeModules)) {
        Write-Warn2 "Running npm install (first run, this can take a couple of minutes)..."
        Push-Location $Frontend
        try { & $Npm install } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
        Write-Ok "Frontend dependencies installed."
    } else {
        Write-Ok "node_modules already present."
    }
} else {
    Write-Warn2 "Skipping npm install (-SkipInstall)."
}

# Seed .env.local from the example if it is missing.
$EnvLocal   = Join-Path $Frontend '.env.local'
$EnvExample = Join-Path $Frontend '.env.local.example'
if ((-not (Test-Path $EnvLocal)) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvLocal
    if ($BackendPort -ne 8000) {
        # Point the frontend at the chosen backend port (BOM-free write).
        $content = (Get-Content $EnvLocal -Raw) -replace '127\.0\.0\.1:8000', "127.0.0.1:$BackendPort"
        [System.IO.File]::WriteAllText($EnvLocal, $content)
    }
    Write-Ok "Created frontend\.env.local"
}

# ===========================================================================
# 3. Launch both servers (each in its own window)
# ===========================================================================
Write-Step "Launching servers"

$backendCommand = "Set-Location '$Backend'; " +
                  "& '$VenvPython' -m uvicorn main:app --reload --host 127.0.0.1 --port $BackendPort"
$BackendProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-Command', $backendCommand -PassThru
Write-Ok "Backend  -> http://127.0.0.1:$BackendPort  (PID $($BackendProc.Id))"

$frontendCommand = "Set-Location '$Frontend'; & '$Npm' run dev -- --port $FrontendPort"
$FrontendProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoExit', '-Command', $frontendCommand -PassThru
Write-Ok "Frontend -> http://localhost:$FrontendPort  (PID $($FrontendProc.Id))"

# ===========================================================================
# 4. Wait for the backend, then open the browser
# ===========================================================================
Write-Step "Waiting for the backend to come up"
Write-Warn2 "(First run downloads the Whisper + embedding models - this may take a while.)"

$healthUrl = "http://127.0.0.1:$BackendPort/health"
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}

if ($ready) { Write-Ok "Backend is healthy." }
else        { Write-Warn2 "Backend not confirmed yet - opening the app anyway." }

Start-Process "http://localhost:$FrontendPort"

Write-Host ""
Write-Host "  Project is running:" -ForegroundColor White
Write-Host "    Frontend : http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "    Backend  : http://127.0.0.1:$BackendPort      (docs: /docs)" -ForegroundColor Green
Write-Host ""
Write-Host "  To stop: close the two server windows that just opened" -ForegroundColor DarkGray
Write-Host "  (or run: Stop-Process -Id $($BackendProc.Id), $($FrontendProc.Id))" -ForegroundColor DarkGray
Write-Host ""
