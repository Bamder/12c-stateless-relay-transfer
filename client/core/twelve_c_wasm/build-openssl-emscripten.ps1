#Requires -Version 5.1
<#
.SYNOPSIS
  为 Emscripten 交叉编译 OpenSSL 静态库（libcrypto），供 twelve_c WASM 链接。

.DESCRIPTION
  构建链第 2 步（按需，build-wasm.ps1 会自动调用）。产物：
    third_party/openssl-emscripten/{include,lib/libcrypto.a}

  推荐工具版本（Windows，已验证组合）：
    - Emscripten 6.0.x（emsdk latest）
    - OpenSSL 1.1.1w（默认；3.x 需更完整 Perl，Git Perl 不适用）
    - Perl：Strawberry Perl 或 MSYS2 perl（需 Pod::Usage）
    - CMake / make：系统 mingw32-make（OpenSSL 构建用）
    - tar：C:\Windows\System32\tar.exe（脚本已规避 Git MSYS tar + X:\ 路径问题；见 README Mitigated 节）

  脚本无法自动解决：
    - Git 自带 MSYS Perl 模块不全 → 安装 Strawberry 或 MSYS2 perl，或 -PerlPath
    - 首次 emsdk 未激活 → 先跑 setup-emsdk.ps1

  脚本已规避、但手动/其它环境仍可能发生（见 README Mitigated 节）：
    - Git MSYS tar 对任意 X:\ 路径（P:\、D:\ 等）→ .ps1 已用 System32 tar
    - MSYS sh 破坏 emcc 绝对路径 → Makefile 已改 CC=emcc 等

  通常不必单独运行；直接 build-wasm.ps1 即可。

.EXAMPLE
  .\build-openssl-emscripten.ps1
  .\build-openssl-emscripten.ps1 -PerlPath 'C:\Strawberry\perl\bin\perl.exe'
#>
[CmdletBinding()]
param(
    [string]$EmsdkRoot = $env:EMSDK,
    [string]$OpenSslVersion = "1.1.1w",
    [string]$PerlPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $PSScriptRoot) {
    throw "PSScriptRoot is empty; run with: .\build-openssl-emscripten.ps1"
}
$ProjectDir = $PSScriptRoot
$ThirdPartyDir = Join-Path $ProjectDir "third_party"
$InstallRoot = Join-Path $ThirdPartyDir "openssl-emscripten"
$CryptoLib = Join-Path $InstallRoot "lib\libcrypto.a"
$SourceDir = Join-Path $ThirdPartyDir "openssl-$OpenSslVersion"
$Tarball = Join-Path $ThirdPartyDir "openssl-$OpenSslVersion.tar.gz"
$DownloadUrl = "https://www.openssl.org/source/openssl-$OpenSslVersion.tar.gz"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Get-PerlCandidates {
    $candidates = @(
        "$env:ProgramFiles\Strawberry\perl\bin\perl.exe",
        "C:\Strawberry\perl\bin\perl.exe",
        "D:\Development\msys64\usr\bin\perl.exe",
        "C:\msys64\usr\bin\perl.exe",
        "$env:ProgramFiles\msys64\usr\bin\perl.exe"
    )

    $cmd = Get-Command perl -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike "*\Git\usr\bin\*") {
        $candidates += $cmd.Source
    }

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $gitRoot = Split-Path (Split-Path $gitCmd.Source -Parent) -Parent
        $candidates += (Join-Path $gitRoot "usr\bin\perl.exe")
    }

    $candidates += @(
        "$env:ProgramFiles\Git\usr\bin\perl.exe",
        "${env:ProgramFiles(x86)}\Git\usr\bin\perl.exe",
        "D:\Development\Git\usr\bin\perl.exe",
        "C:\Program Files\Git\usr\bin\perl.exe",
        "$env:LOCALAPPDATA\Programs\Git\usr\bin\perl.exe"
    )

    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}

function Test-OpenSslPerl([string]$PerlPath) {
    Set-OpenSslBuildEnvironment
    & $PerlPath -MPod::Usage -e "exit 0" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

function Set-OpenSslBuildEnvironment {
    # Git MSYS Perl + zh_CN locale breaks OpenSSL Configure on Windows.
    $env:LC_ALL = "C"
    $env:LANG = "C"
    $env:LANGUAGE = "C"
    $env:PERL_BADLANG = "0"
}

function Ensure-Perl {
    param([ref]$PerlExe)

    $candidates = Get-PerlCandidates
    foreach ($path in $candidates) {
        if (Test-OpenSslPerl $path) {
            $PerlExe.Value = $path
            $perlDir = Split-Path $path -Parent
            if ($env:PATH -notlike "*$perlDir*") {
                $env:PATH = "$perlDir;$env:PATH"
            }
            Write-Host "Using Perl: $path"
            return
        }
        Write-Host "Skipping Perl (missing modules for OpenSSL): $path"
    }

    $tried = ($candidates -join "`n  ")
    throw @"
No suitable Perl found for OpenSSL Configure (needs Pod::Usage and related core modules).

Tried:
  $tried

On Windows, install one of:
  1. Strawberry Perl (recommended): https://strawberryperl.com/
  2. MSYS2 Perl: pacman -S perl (then use C:\msys64\usr\bin\perl.exe)

Then re-run:
  .\build-openssl-emscripten.ps1 -PerlPath 'C:\Strawberry\perl\bin\perl.exe'
"@
}

function Ensure-EmscriptenActive {
    if (Get-Command emconfigure -ErrorAction SilentlyContinue) {
        return
    }

    $roots = @(
        $EmsdkRoot,
        $env:EMSDK,
        "$env:USERPROFILE\emsdk",
        "P:\_Tools\emsdk"
    ) | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        $envScript = Join-Path $root "emsdk_env.ps1"
        if (Test-Path $envScript) {
            Write-Host "Activating emsdk from $root ..."
            . $envScript
            if (Get-Command emconfigure -ErrorAction SilentlyContinue) {
                return
            }
        }
    }

    throw "Emscripten not active. Run setup-emsdk.ps1 and/or build-wasm.ps1 first."
}

function Clear-OpenSslCrossCompile([string]$MakefilePath) {
    if (-not (Test-Path $MakefilePath)) {
        throw "OpenSSL Makefile not found: $MakefilePath"
    }

    $lines = Get-Content $MakefilePath
    $lines = $lines | ForEach-Object {
        if ($_ -match '^\s*CROSS_COMPILE\s*=') { "CROSS_COMPILE=" } else { $_ }
    }
    Set-Content -Path $MakefilePath -Value $lines -Encoding ascii
}

function Fix-OpenSslMakefileToolchain([string]$MakefilePath) {
    if (-not (Test-Path $MakefilePath)) {
        return
    }

    # MSYS sh mangles "P:\...\emcc.exe" into "P:_Tools...emcc.exe". Use short names from PATH.
    Require-Command emcc
    Require-Command em++
    Require-Command emar

    $lines = Get-Content $MakefilePath
    $lines = $lines | ForEach-Object {
        if ($_ -match '^\s*CC\s*=') { "CC=emcc" }
        elseif ($_ -match '^\s*CXX\s*=') { "CXX=em++" }
        elseif ($_ -match '^\s*AR\s*=') { "AR=emar" }
        elseif ($_ -match '^\s*RANLIB\s*=') { "RANLIB=emranlib" }
        else { $_ }
    }
    Set-Content -Path $MakefilePath -Value $lines -Encoding ascii
}

function Get-WindowsTarPath {
    $windowsTar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (Test-Path $windowsTar) {
        return $windowsTar
    }
    throw "Windows tar.exe not found at $windowsTar"
}

function Expand-OpenSslArchive([string]$ArchivePath, [string]$DestinationDir) {
    # Git/MSYS tar treats any "X:\..." as remote host "X" — use Windows tar + relative paths.
    $tar = Get-WindowsTarPath
    $archiveName = Split-Path $ArchivePath -Leaf
    $destArchive = Join-Path $DestinationDir $archiveName

    if ($ArchivePath -ne $destArchive) {
        Copy-Item -Force $ArchivePath $destArchive
    }

    Push-Location $DestinationDir
    try {
        Write-Host "Extracting with $tar ..."
        & $tar -xf $archiveName
        if ($LASTEXITCODE -ne 0) {
            throw "tar extract failed (exit $LASTEXITCODE)"
        }
    }
    finally {
        Pop-Location
    }
}

if (Test-Path $CryptoLib) {
    Write-Host "OpenSSL for Emscripten already built: $CryptoLib"
    return
}

Ensure-EmscriptenActive
Require-Command emconfigure
Require-Command emmake

$PerlExe = $null
if ($PerlPath) {
    if (-not (Test-Path $PerlPath)) {
        throw "Perl not found at: $PerlPath"
    }
    $PerlExe = (Resolve-Path $PerlPath).Path
    $perlDir = Split-Path $PerlExe -Parent
    if ($env:PATH -notlike "*$perlDir*") {
        $env:PATH = "$perlDir;$env:PATH"
    }
    Write-Host "Using Perl: $PerlExe"
} else {
    Ensure-Perl ([ref]$PerlExe)
}

New-Item -ItemType Directory -Force -Path $ThirdPartyDir | Out-Null

if ((Test-Path $SourceDir) -and -not (Test-Path (Join-Path $SourceDir "Configure"))) {
    Write-Host "Removing incomplete OpenSSL source at $SourceDir ..."
    Remove-Item -Recurse -Force $SourceDir
}

if (-not (Test-Path (Join-Path $SourceDir "Configure"))) {
    if (-not (Test-Path $Tarball)) {
        Write-Host "Downloading OpenSSL $OpenSslVersion ..."
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $Tarball
    }

    Write-Host "Extracting OpenSSL source ..."
    Expand-OpenSslArchive $Tarball $ThirdPartyDir
}

if (-not (Test-Path (Join-Path $SourceDir "Configure"))) {
    throw @"
OpenSSL source incomplete at $SourceDir

If extraction failed before, delete:
  $ThirdPartyDir
and re-run this script.
"@
}

$PrefixUnix = ($InstallRoot -replace '\\', '/')
Set-OpenSslBuildEnvironment

$IsOpenSsl3 = $OpenSslVersion -match '^3\.'
$InstallTarget = if ($IsOpenSsl3) { "install_sw" } else { "install_dev" }

Push-Location $SourceDir
try {
    if (Test-Path "Makefile") {
        emmake make clean | Out-Null
    }

    Write-Host "Configuring OpenSSL $OpenSslVersion for Emscripten (no-asm static libcrypto) ..."
    if ($IsOpenSsl3) {
        & emconfigure $PerlExe Configure `
            linux-x32 `
            no-shared `
            no-asm `
            no-tests `
            no-ui-console `
            no-docs `
            no-ssl3 `
            no-dtls `
            no-engine `
            --prefix="$PrefixUnix" `
            --openssldir="$PrefixUnix"
    } else {
        & emconfigure $PerlExe Configure `
            linux-x32 `
            no-shared `
            no-asm `
            no-tests `
            --prefix="$PrefixUnix" `
            --openssldir="$PrefixUnix"
    }
    if ($LASTEXITCODE -ne 0) {
        $makefile = Join-Path $SourceDir "Makefile"
        if (Test-Path $makefile) {
            Write-Host "Configure exited with code $LASTEXITCODE but Makefile exists; continuing build ..."
        } else {
            throw "OpenSSL Configure failed"
        }
    }

    Clear-OpenSslCrossCompile (Join-Path $SourceDir "Makefile")
    Fix-OpenSslMakefileToolchain (Join-Path $SourceDir "Makefile")

    Write-Host "Building libcrypto.a (may take several minutes) ..."
    emmake make -j2 build_generated libcrypto.a
    if ($LASTEXITCODE -ne 0) { throw "OpenSSL build failed" }

    Write-Host "Installing OpenSSL headers and libcrypto.a ($InstallTarget) ..."
    emmake make $InstallTarget
    if ($LASTEXITCODE -ne 0) { throw "OpenSSL $InstallTarget failed" }
}
finally {
    Pop-Location
}

if (-not (Test-Path $CryptoLib)) {
    throw "Expected output missing: $CryptoLib"
}

Write-Host "OpenSSL for Emscripten ready at $InstallRoot"
