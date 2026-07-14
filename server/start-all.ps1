# 依次在新窗口启动 Registry、Relay，并在当前窗口启动 Console
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "Launching Registry (includes Client Web when dist/ is built)..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "registry\start.ps1")
)

Start-Sleep -Seconds 2

Write-Host "Launching Relay..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "relay\start.ps1")
)

Start-Sleep -Seconds 1

Write-Host "Launching Console..."
Set-Location (Join-Path $Root "console")
& ".\start.ps1"
