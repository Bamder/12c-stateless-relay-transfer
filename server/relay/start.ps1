# Relay 启动脚本
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$Pip = Join-Path $PSScriptRoot ".venv\Scripts\pip.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

& $Pip install -r requirements.txt -q

if (-not (Test-Path "relay_server.config.json")) {
    Copy-Item "relay_server.config.example.json" "relay_server.config.json"
    Write-Host "Created relay_server.config.json — adminApiKey auto-generates in relay_server.secrets.json."
}

Write-Host "Starting Relay on http://127.0.0.1:9090 ..."
& $Python -m relay_server @args
