#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$StateDir = Join-Path $env:LOCALAPPDATA "12c-stateless-relay-transfer\cloudflare-public"
$StatePath = Join-Path $StateDir "state.json"

if (-not (Test-Path -LiteralPath $StatePath)) {
    Write-Host "No recorded 12C Cloudflare Quick Tunnels were found."
    exit 0
}

$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
foreach ($pidValue in @($state.registryPid, $state.relayPid)) {
    if (-not $pidValue) {
        continue
    }
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "cloudflared") {
        Stop-Process -Id $process.Id -Force
        Write-Host "Stopped cloudflared PID $($process.Id)"
    }
}

Remove-Item -LiteralPath $StatePath -Force
Write-Host "Cloudflare Quick Tunnels stopped. Existing public QR links are no longer reachable."
