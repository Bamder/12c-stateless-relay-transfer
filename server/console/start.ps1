# Console 控制面板启动脚本
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

& $Python -m pip install -r requirements.txt -q
if ($LASTEXITCODE -ne 0) {
    throw "Console dependency installation failed. Check pip proxy and index settings above."
}

if (-not (Test-Path "console_server.config.json")) {
    Copy-Item "console_server.config.example.json" "console_server.config.json"
    Write-Host "Created console_server.config.json — admin keys auto-sync from service *.secrets.json on startup."
}

Write-Host "Starting Console on http://127.0.0.1:8070 ..."
& $Python -m console_server @args
