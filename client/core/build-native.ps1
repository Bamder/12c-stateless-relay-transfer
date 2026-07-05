#Requires -Version 5.1
<#
.SYNOPSIS
  原生 C++ 编译 twelve_c（桌面 OpenSSL），输出到仓库根 build-test/native/。

.DESCRIPTION
  用于快速验证 client/core/12c_file_transfer_scheme 源码，不经过 Emscripten。
  需要系统已安装 CMake 3.20+ 与 OpenSSL 开发包。

.EXAMPLE
  cd client\core
  .\build-native.ps1
#>
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = "Stop"
$CoreRoot = $PSScriptRoot
$SchemeDir = Join-Path $CoreRoot "12c_file_transfer_scheme"
$RepoRoot = (Resolve-Path (Join-Path $CoreRoot "..\..")).Path
$BuildDir = Join-Path $RepoRoot "build-test\native"

if (-not (Test-Path $SchemeDir)) {
    throw "Scheme sources not found: $SchemeDir"
}

Write-Host "==> CMake configure ($Configuration)" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
cmake -S $SchemeDir -B $BuildDir -DCMAKE_BUILD_TYPE=$Configuration
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }

Write-Host "==> CMake build" -ForegroundColor Cyan
cmake --build $BuildDir --config $Configuration
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

Write-Host ""
Write-Host "Native build output: $BuildDir" -ForegroundColor Green
