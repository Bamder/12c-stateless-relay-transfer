#Requires -Version 5.1
<#
.SYNOPSIS
  一次性安装并激活 Emscripten SDK（Windows）。

.DESCRIPTION
  构建链第 1 步（仅需一次）。安装 emsdk + Emscripten latest（当前验证：6.0.x）。

  推荐工具版本（Windows）：
    - Git（clone emsdk）
    - Python 3.x（emsdk 自带或系统 python，用于 emsdk install）
    - 磁盘：emsdk ~2GB+；P: 盘等大体积下载需稳定网络

  脚本无法自动解决：
    - wasm-binaries.zip 下载损坏 → 删 emsdk/downloads/* 后重跑 install
    - 无 git / python → 需手动安装

  后续步骤见 build-wasm.ps1 头部说明。

.PARAMETER SetEnv
  将 EMSDK 写入当前 PowerShell 会话，并持久化到用户级环境变量（新开终端生效）。

.EXAMPLE
  .\setup-emsdk.ps1
  .\setup-emsdk.ps1 -InstallRoot P:\_Tools\emsdk
  .\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk -SetEnv
#>
[CmdletBinding()]
param(
    [Alias('EmsdkRoot')]
    [string]$InstallRoot = $(if ($env:EMSDK) { $env:EMSDK } else { Join-Path $env:USERPROFILE "emsdk" }),

    [switch]$SetEnv
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Set-EmsdkEnvironment([string]$Root) {
    $env:EMSDK = $Root
    [Environment]::SetEnvironmentVariable("EMSDK", $Root, "User")
    Write-Host "EMSDK=$Root (current session + User env; new terminals will inherit)."
}

function Get-EmsdkLauncher([string]$Root) {
    foreach ($name in @("emsdk.ps1", "emsdk.bat")) {
        $path = Join-Path $Root $name
        if (Test-Path $path) {
            return $path
        }
    }
    return $null
}

function Invoke-Emsdk([string]$Root, [string[]]$EmsdkArgs) {
    $launcher = Get-EmsdkLauncher $Root
    if (-not $launcher) {
        throw "emsdk launcher not found in $Root (incomplete clone?)"
    }
    & $launcher @EmsdkArgs
    if ($LASTEXITCODE -ne 0) {
        throw "emsdk $($EmsdkArgs -join ' ') failed (exit $LASTEXITCODE)"
    }
}

Require-Command git

$launcherPath = Get-EmsdkLauncher $InstallRoot
if (-not $launcherPath) {
    if (Test-Path $InstallRoot) {
        $hasContents = @(Get-ChildItem $InstallRoot -Force -ErrorAction SilentlyContinue).Count -gt 0
        if ($hasContents) {
            throw @"
emsdk directory exists at $InstallRoot but emsdk.ps1 is missing.
Remove the folder or fix the clone, then re-run this script.
"@
        }
    }
    Write-Host "Cloning emsdk to $InstallRoot ..."
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallRoot -Parent) | Out-Null
    git clone https://github.com/emscripten-core/emsdk.git $InstallRoot
    if ($LASTEXITCODE -ne 0) { throw "git clone emsdk failed" }
    $launcherPath = Get-EmsdkLauncher $InstallRoot
    if (-not $launcherPath) {
        throw "git clone finished but emsdk.ps1 still missing in $InstallRoot"
    }
}

Push-Location $InstallRoot
try {
    Require-Command python
    Write-Host "Installing Emscripten (latest) — may take several minutes ..."
    Invoke-Emsdk $InstallRoot @("install", "latest")

    Invoke-Emsdk $InstallRoot @("activate", "latest")

    if ($SetEnv) {
        Set-EmsdkEnvironment $InstallRoot
    }

    Write-Host ""
    Write-Host "Emscripten installed at: $InstallRoot"
    Write-Host "Next steps:"
    Write-Host "  1. In THIS shell:  . `"$InstallRoot\emsdk_env.ps1`""
    Write-Host "  2. Build WASM:     .\build-wasm.ps1"
    if (-not $SetEnv) {
        Write-Host ""
        Write-Host "Optional: persist EMSDK for future sessions:"
        Write-Host "  .\setup-emsdk.ps1 -EmsdkRoot `"$InstallRoot`" -SetEnv"
    }
}
finally {
    Pop-Location
}
