#Requires -Version 5.1
<#
.SYNOPSIS
  Publish the local Registry and Relay through two Cloudflare Quick Tunnels.

.DESCRIPTION
  Quick Tunnels require no Cloudflare login, but their trycloudflare.com URLs
  change whenever the tunnel processes restart. Keep this script running state
  alive for every QR code that should remain usable.
#>
param(
    [string]$CloudflaredPath,
    [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$ConsoleBaseUrl = "http://127.0.0.1:8070"
$RegistryOrigin = "http://127.0.0.1:8080"
$RelayOrigin = "http://127.0.0.1:9090"
$StateDir = Join-Path $env:LOCALAPPDATA "12c-stateless-relay-transfer\cloudflare-public"
$StatePath = Join-Path $StateDir "state.json"

function Resolve-Cloudflared {
    if ($CloudflaredPath) {
        if (-not (Test-Path -LiteralPath $CloudflaredPath)) {
            throw "cloudflared not found: $CloudflaredPath"
        }
        return (Resolve-Path -LiteralPath $CloudflaredPath).Path
    }

    $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }

    $candidates = @(
        "C:\Program Files\cloudflared\cloudflared.exe",
        "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "cloudflared not found. Install it with: winget install Cloudflare.cloudflared"
}

function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(1500)) {
            return $false
        }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Stop-RecordedTunnels {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        return
    }

    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        foreach ($pidValue in @($state.registryPid, $state.relayPid)) {
            if (-not $pidValue) {
                continue
            }
            $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
            if ($process -and $process.ProcessName -eq "cloudflared") {
                Stop-Process -Id $process.Id -Force
            }
        }
    } catch {
        Write-Warning "Could not clean previous Cloudflare tunnel state: $($_.Exception.Message)"
    }
}

function Start-QuickTunnel([string]$Name, [string]$Origin, [string]$Executable) {
    $stdoutPath = Join-Path $StateDir "$Name.stdout.log"
    $stderrPath = Join-Path $StateDir "$Name.stderr.log"
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    $process = Start-Process `
        -FilePath $Executable `
        -ArgumentList @("tunnel", "--no-autoupdate", "--protocol", "http2", "--edge-ip-version", "4", "--retries", "10", "--url", $Origin) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    return [pscustomobject]@{
        Name = $Name
        Origin = $Origin
        Process = $process
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
    }
}

function Wait-QuickTunnelUrl($Tunnel, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'

    while ([DateTime]::UtcNow -lt $deadline) {
        $Tunnel.Process.Refresh()
        $text = ""
        foreach ($path in @($Tunnel.StdoutPath, $Tunnel.StderrPath)) {
            if (Test-Path -LiteralPath $path) {
                $text += "`n" + (Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue)
            }
        }
        $match = [regex]::Match($text, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) {
            return $match.Value.TrimEnd("/")
        }
        if ($Tunnel.Process.HasExited) {
            throw "$($Tunnel.Name) Cloudflare tunnel exited early (code $($Tunnel.Process.ExitCode)). See $($Tunnel.StderrPath)"
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for $($Tunnel.Name) Cloudflare URL. See $($Tunnel.StderrPath)"
}

function Wait-PublicEndpoint([string]$Url, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = "no response"
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return
            }
            $lastError = "HTTP $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 1
    }
    throw "Public endpoint did not become ready: $Url ($lastError)"
}

function Invoke-ConsoleJson(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
) {
    $parameters = @{
        Method = $Method
        Uri = "$ConsoleBaseUrl$Path"
        UseBasicParsing = $true
        TimeoutSec = 15
    }
    if ($null -ne $Body) {
        $parameters.ContentType = "application/json"
        $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 10
    }
    return Invoke-RestMethod @parameters
}

if ($StartupTimeoutSeconds -lt 10 -or $StartupTimeoutSeconds -gt 300) {
    throw "StartupTimeoutSeconds must be between 10 and 300"
}
if (-not (Test-LocalPort 8070) -or -not (Test-LocalPort 8080) -or -not (Test-LocalPort 9090)) {
    throw "Console, Registry, and Relay must be running first. Run server\start-all.ps1 and approve the Relay registration."
}

$Cloudflared = Resolve-Cloudflared
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
Stop-RecordedTunnels

$registryTunnel = $null
$relayTunnel = $null
try {
    Write-Host "Starting Cloudflare Quick Tunnel for Registry ..." -ForegroundColor Cyan
    $registryTunnel = Start-QuickTunnel "registry" $RegistryOrigin $Cloudflared
    Write-Host "Starting Cloudflare Quick Tunnel for Relay ..." -ForegroundColor Cyan
    $relayTunnel = Start-QuickTunnel "relay" $RelayOrigin $Cloudflared

    $registryPublicUrl = Wait-QuickTunnelUrl $registryTunnel $StartupTimeoutSeconds
    $relayPublicUrl = Wait-QuickTunnelUrl $relayTunnel $StartupTimeoutSeconds
    Wait-PublicEndpoint "$registryPublicUrl/" $StartupTimeoutSeconds
    Wait-PublicEndpoint "$relayPublicUrl/health" $StartupTimeoutSeconds

    $relayId = $null
    try {
        $overview = Invoke-ConsoleJson "GET" "/api/relay/overview"
        $relayId = $overview.relayId
        if (-not $relayId -and $overview.relay) {
            $relayId = $overview.relay.relayId
        }
    } catch {
        Write-Warning "Relay ID could not be read; Registry Allowlist may need a manual URL update."
    }

    $publicUrlBody = @{ publicBaseUrl = $relayPublicUrl }
    if ($relayId) {
        $publicUrlBody.relayId = $relayId
    }
    $updateResult = Invoke-ConsoleJson "PUT" "/api/config/relay-public-url" $publicUrlBody

    Invoke-ConsoleJson "POST" "/api/services/relay/stop" | Out-Null
    Start-Sleep -Seconds 1
    Invoke-ConsoleJson "POST" "/api/services/relay/start" @{ detached = $true } | Out-Null
    Wait-PublicEndpoint "$relayPublicUrl/health" $StartupTimeoutSeconds
    Wait-PublicEndpoint "$registryPublicUrl/" $StartupTimeoutSeconds
    foreach ($tunnel in @($registryTunnel, $relayTunnel)) {
        $tunnel.Process.Refresh()
        if ($tunnel.Process.HasExited) {
            throw "$($tunnel.Name) Cloudflare tunnel exited before setup completed (code $($tunnel.Process.ExitCode))."
        }
    }

    $state = [ordered]@{
        createdAt = [DateTime]::UtcNow.ToString("o")
        registryUrl = $registryPublicUrl
        relayUrl = $relayPublicUrl
        registryPid = $registryTunnel.Process.Id
        relayPid = $relayTunnel.Process.Id
        allowlistSynced = [bool]$updateResult.allowlistSynced
    }
    $json = $state | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($StatePath, $json, (New-Object Text.UTF8Encoding($false)))

    Write-Host ""
    Write-Host "Cloudflare public access is ready." -ForegroundColor Green
    Write-Host "Registry / QR URL: $registryPublicUrl" -ForegroundColor Green
    Write-Host "Relay URL:         $relayPublicUrl" -ForegroundColor Green
    Write-Host "Allowlist synced:  $([bool]$updateResult.allowlistSynced)"
    Write-Host ""
    Write-Host "Open the Registry URL above to upload and generate a phone-accessible QR code."
    Write-Host "Quick Tunnel URLs change after restart; existing QR codes then stop working."
    Write-Host "Stop tunnels with: .\stop-cloudflare-public.ps1"
} catch {
    foreach ($tunnel in @($registryTunnel, $relayTunnel)) {
        if ($tunnel -and -not $tunnel.Process.HasExited) {
            Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    throw
}
