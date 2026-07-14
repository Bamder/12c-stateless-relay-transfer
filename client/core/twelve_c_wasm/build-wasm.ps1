#Requires -Version 5.1
<#
.SYNOPSIS
  构建 twelve_c WASM 并复制到 client/transfer/src/wasm/pkg/

.DESCRIPTION
  构建链第 3 步（日常开发）。WASM 产物输出目录（注意含 src，不是 transfer/wasm/pkg）：
    client/transfer/src/wasm/pkg/twelve_c_cryptography.{js,wasm}

  使用顺序（Windows）：
    1. .\setup-emsdk.ps1 -EmsdkRoot <path> -SetEnv     # 一次性
    2. 安装 Strawberry Perl 或 MSYS2 perl               # 若 OpenSSL 构建报 Perl 错
    3. .\build-wasm.ps1                                 # 自动编 OpenSSL + WASM

  推荐工具版本：
    - Emscripten 6.0.x + emcmake / em++ / emcc
    - CMake 3.20+（系统 cmake，由 emcmake 驱动）
    - OpenSSL 1.1.1w → libcrypto.a（见 build-openssl-emscripten.ps1）

  脚本无法自动解决：
    - Emscripten 6 无 USE_OPENSSL port，OpenSSL 必须单独交叉编译
    - 网络不稳定导致 emsdk/OpenSSL 源码下载失败 → 手动重试或清缓存目录

.PARAMETER EmsdkRoot
  emsdk 根目录（含 emsdk_env.ps1）。未指定则自动探测。

.EXAMPLE
  .\build-wasm.ps1
  .\build-wasm.ps1 -EmsdkRoot D:\Development\emsdk
#>
param(
    [string]$EmsdkRoot = $env:EMSDK
)

$ErrorActionPreference = "Stop"

$ProjectDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptPath = $MyInvocation.MyCommand.Path
    }
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw @"
Cannot resolve script directory.

Run:
  cd client\core\twelve_c_wasm
  .\build-wasm.ps1 -EmsdkRoot P:\_Tools\emsdk
"@
    }
    $ProjectDir = [System.IO.Path]::GetDirectoryName($scriptPath)
}
if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    throw "Failed to resolve ProjectDir"
}
Set-Location $ProjectDir
$BuildDir = Join-Path $ProjectDir "build"
# client/transfer/src/wasm/pkg (not client/transfer/wasm/pkg)
$TransferRoot = Join-Path $ProjectDir "..\..\transfer"
if (-not (Test-Path $TransferRoot)) {
    throw "transfer package directory not found: $TransferRoot"
}
$TransferRoot = (Resolve-Path $TransferRoot).Path
$OutDir = Join-Path $TransferRoot "src\wasm\pkg"

function Get-EmscriptenCandidates {
    $roots = @(
        $EmsdkRoot,
        $env:EMSDK,
        "$env:USERPROFILE\emsdk",
        "P:\_Tools\emsdk",
        "C:\emsdk",
        "D:\Development\emsdk",
        "D:\emsdk"
    ) | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique

    $paths = @()
    if ($env:EMSCRIPTEN) {
        $paths += $env:EMSCRIPTEN
    }
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        $paths += (Join-Path $root "upstream\emscripten")
    }
    return $paths | Select-Object -Unique
}

function Test-EmscriptenRoot([string]$Root) {
    if (-not $Root -or -not (Test-Path $Root)) {
        return $false
    }
    foreach ($name in @("emcmake.exe", "emcmake.bat", "emcmake")) {
        if (Test-Path (Join-Path $Root $name)) {
            return $true
        }
    }
    return $false
}

function Find-EmscriptenRoot {
    foreach ($emscriptenRoot in Get-EmscriptenCandidates) {
        if (Test-EmscriptenRoot $emscriptenRoot) {
            return $emscriptenRoot
        }
    }

    $cmd = Get-Command emcmake -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return Split-Path $cmd.Source -Parent
    }

    return $null
}

function Get-EmcmakeCommand([string]$EmscriptenRoot) {
    foreach ($name in @("emcmake.exe", "emcmake.bat")) {
        $tool = Join-Path $EmscriptenRoot $name
        if (Test-Path $tool) {
            return $tool
        }
    }

    $cmd = Get-Command emcmake -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    throw "emcmake not found under $EmscriptenRoot (Emscripten 6+ uses emcmake.exe, not emcmake.bat)"
}

function Find-CMakeCommand {
    $cmd = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $candidates = @(
        "C:\Program Files\CMake\bin\cmake.exe",
        "C:\Program Files (x86)\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "cmake not found (install CMake 3.20+ or the Visual Studio C++ CMake tools component)"
}

function Find-NinjaCommand {
    $cmd = Get-Command ninja.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $candidates = @(
        "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "ninja not found (install Ninja or the Visual Studio C++ CMake tools component)"
}

function Initialize-Emscripten {
    $found = Find-EmscriptenRoot
    if ($found) {
        return $found
    }

    $emsdkRoots = @(
        $EmsdkRoot,
        $env:EMSDK,
        "$env:USERPROFILE\emsdk",
        "P:\_Tools\emsdk",
        "C:\emsdk",
        "D:\Development\emsdk",
        "D:\emsdk"
    ) | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique

    foreach ($root in $emsdkRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        $envScript = Join-Path $root "emsdk_env.ps1"
        if (-not (Test-Path $envScript)) {
            continue
        }
        Write-Host "Activating emsdk from $root ..."
        . $envScript
        $found = Find-EmscriptenRoot
        if ($found) {
            return $found
        }
    }

    return $null
}

function Resolve-EmsdkRoot([string]$EmscriptenRoot) {
    if ($EmsdkRoot -and $EmsdkRoot.Trim() -ne "") {
        return $EmsdkRoot.Trim()
    }
    if ($env:EMSDK -and $env:EMSDK.Trim() -ne "") {
        return $env:EMSDK.Trim()
    }
    if ($EmscriptenRoot -and $EmscriptenRoot -match '[\\/]upstream[\\/]emscripten$') {
        return (Split-Path (Split-Path $EmscriptenRoot -Parent) -Parent)
    }
    foreach ($root in @(
            "P:\_Tools\emsdk",
            "$env:USERPROFILE\emsdk",
            "C:\emsdk",
            "D:\Development\emsdk",
            "D:\emsdk"
        )) {
        if (
            $root -and
            (Test-Path -LiteralPath $root) -and
            (Test-Path (Join-Path $root "emsdk_env.ps1"))
        ) {
            return $root
        }
    }
    return $null
}

$EmscriptenRoot = Initialize-Emscripten
if (-not $EmscriptenRoot) {
    Write-Error @"
Emscripten not found.

First-time setup (requires git + python):
  cd $ProjectDir
  .\setup-emsdk.ps1

Then activate and build in the same shell:
  . `"`$env:USERPROFILE\emsdk\emsdk_env.ps1`"
  .\build-wasm.ps1

Or pass your emsdk path:
  .\build-wasm.ps1 -EmsdkRoot D:\Development\emsdk
"@ 
}

$EmsdkRoot = Resolve-EmsdkRoot $EmscriptenRoot
if (-not $EmsdkRoot) {
    Write-Error "Could not resolve emsdk root (pass -EmsdkRoot P:\_Tools\emsdk)"
}

$Emcmake = Get-EmcmakeCommand $EmscriptenRoot
$CMake = Find-CMakeCommand
$Ninja = Find-NinjaCommand
Write-Host "Using Emscripten: $EmscriptenRoot"
Write-Host "Using emcmake: $Emcmake"
Write-Host "Using CMake: $CMake"
Write-Host "Using Ninja: $Ninja"

$OpenSslCrypto = Join-Path $ProjectDir "third_party\openssl-emscripten\lib\libcrypto.a"
if (-not (Test-Path $OpenSslCrypto)) {
    $BuildOpenSsl = Join-Path $ProjectDir "build-openssl-emscripten.ps1"
    Write-Host "OpenSSL for Emscripten not found; building (one-time, may take several minutes) ..."
    & $BuildOpenSsl -EmsdkRoot $EmsdkRoot
    if ($LASTEXITCODE -ne 0) { throw "build-openssl-emscripten failed" }
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

& $Emcmake $CMake -S $ProjectDir -B $BuildDir -G Ninja "-DCMAKE_MAKE_PROGRAM=$Ninja" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { throw "emcmake failed" }

& $CMake --build $BuildDir --config Release
if ($LASTEXITCODE -ne 0) { throw "wasm build failed" }

$JsFile = Join-Path $BuildDir "twelve_c_cryptography.js"
$WasmFile = Join-Path $BuildDir "twelve_c_cryptography.wasm"

if (-not (Test-Path $JsFile)) {
    throw "missing output: $JsFile"
}
if (-not (Test-Path $WasmFile)) {
    throw "missing output: $WasmFile"
}

Copy-Item -Force $JsFile $OutDir
Copy-Item -Force $WasmFile $OutDir
Write-Host "WASM artifacts copied to $OutDir"
Write-Host "  (client/transfer/src/wasm/pkg — loader.ts imports ./pkg/...)"
