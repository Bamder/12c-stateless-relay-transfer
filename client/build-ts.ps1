#Requires -Version 5.1
<#
.SYNOPSIS
  编译 Client TypeScript 工作区 (transfer -> app)。

.DESCRIPTION
  输出 dist/ 供 @stateless-relay/web 与 IDE 类型检查使用。
  不涉及 WASM 或 Vite 打包。

.EXAMPLE
  cd client
  .\build-ts.ps1
#>
$ErrorActionPreference = "Stop"
$ClientRoot = $PSScriptRoot

Set-Location $ClientRoot

Write-Host ""
Write-Host "==> 编译 TypeScript 工作区 (transfer -> app)" -ForegroundColor Cyan
npm run build -w @stateless-relay/transfer
npm run build -w @stateless-relay/app

Write-Host ""
Write-Host "TypeScript build complete." -ForegroundColor Green
