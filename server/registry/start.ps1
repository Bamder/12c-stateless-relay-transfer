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

Write-Host "Starting Registry (+ Client Web when dist/ is built) on http://127.0.0.1:8080 ..."
$DistIndex = Resolve-Path "..\..\client\web\dist\index.html" -ErrorAction SilentlyContinue
if (-not $DistIndex) {
    Write-Host ""
    Write-Host "提示: client/web/dist/ 尚未构建，Registry 仅提供 API。构建后重启即可挂载 Client:" -ForegroundColor Yellow
    Write-Host "  cd client" -ForegroundColor Gray
    Write-Host "  .\build.ps1 -Production" -ForegroundColor Gray
    Write-Host ""
}
& $Python -m registry_server @args
