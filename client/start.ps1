#Requires -Version 5.1
<#
.SYNOPSIS
  构建 Client（如需）并启动 Web 开发服务器。

.DESCRIPTION
  若 transfer/src/wasm/pkg 中缺少 .wasm，会先调用 build.ps1 完成构建。
  等效于：.\build.ps1 && cd web && npm run dev

.PARAMETER SkipBuild
  跳过构建检查，直接启动 dev server。

.EXAMPLE
  cd client
  .\start.ps1
#>
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ClientRoot = $PSScriptRoot
$WasmPkg = Join-Path $ClientRoot "transfer\src\wasm\pkg\twelve_c_cryptography.wasm"

if (-not $SkipBuild) {
    $needsBuild = -not (Test-Path $WasmPkg) -or -not (Test-Path (Join-Path $ClientRoot "node_modules"))
    if ($needsBuild) {
        Write-Host "首次运行或缺少 WASM，正在执行 build.ps1 ..." -ForegroundColor Yellow
        & (Join-Path $ClientRoot "build.ps1")
    } else {
        # 确保 public/wasm 与 pkg 同步
        Set-Location (Join-Path $ClientRoot "web")
        npm run copy:wasm
    }
}

Set-Location (Join-Path $ClientRoot "web")
& ".\start.ps1"
