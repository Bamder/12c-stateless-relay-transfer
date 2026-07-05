# Registry 启动脚本
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$Pip = Join-Path $PSScriptRoot ".venv\Scripts\pip.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

& $Pip install -r requirements.txt -q

if (-not (Test-Path "registry_server.config.json")) {
    Copy-Item "registry_server.config.example.json" "registry_server.config.json"
    Write-Host "Created registry_server.config.json — adminApiKey / blockAuthMasterKey auto-generate in registry_server.secrets.json."
}

Write-Host "Starting Registry on http://127.0.0.1:8080 ..."
& $Python -m registry_server @args
