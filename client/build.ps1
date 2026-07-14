#Requires -Version 5.1
<#
.SYNOPSIS
  一键构建 Client：npm install → build-ts → build-wasm（如需）→ copy:wasm → 可选生产打包。

.DESCRIPTION
  推荐入口脚本。首次克隆仓库后在本目录执行即可，无需手动切换多个子目录。

  子步骤可单独执行：
    .\build-ts.ps1                 # 仅编译 transfer / app TypeScript
    npm run build:wasm             # 仅编译 WASM（core/twelve_c_wasm）

  典型用法：
    .\build.ps1                    # 缺 WASM 时自动编译，并复制到 web/public/wasm/
    .\build.ps1 -SetupEmsdk        # 首次：安装 emsdk 后再构建 WASM
    .\build.ps1 -ForceWasm         # 强制重编 WASM
    .\build.ps1 -SkipTs            # 跳过 TypeScript 编译
    .\build.ps1 -SkipWasm          # 跳过 WASM 编译
    .\build.ps1 -Production        # 额外执行 vite build → web/dist/
    .\start.ps1                    # 构建后启动开发服务器

.PARAMETER SetupEmsdk
  构建前先运行 core/twelve_c_wasm/setup-emsdk.ps1（仅首次需要）。

.PARAMETER EmsdkRoot
  emsdk 安装根目录；传给 setup-emsdk / build-wasm。未指定时使用环境变量 EMSDK 或脚本内自动探测。

.PARAMETER SkipTs
  跳过 TypeScript 编译（须已有 transfer / app 的 dist/ 产物）。

.PARAMETER SkipWasm
  跳过 WASM 编译，仅 copy:wasm（须已有 transfer/src/wasm/pkg 产物）。

.PARAMETER ForceWasm
  即使 pkg 中已有 .wasm 也强制重新编译。

.PARAMETER Production
  构建完成后在 web/ 执行 npm run build，输出 dist/。

.EXAMPLE
  cd client
  .\build.ps1 -SetupEmsdk -EmsdkRoot P:\_Tools\emsdk

.EXAMPLE
  cd client
  .\build.ps1 -Production
#>
param(
    [switch]$SetupEmsdk,
    [string]$EmsdkRoot = $env:EMSDK,
    [switch]$SkipTs,
    [switch]$SkipWasm,
    [switch]$ForceWasm,
    [switch]$Production
)

$ErrorActionPreference = "Stop"
$ClientRoot = $PSScriptRoot
$WasmPkg = Join-Path $ClientRoot "transfer\src\wasm\pkg\twelve_c_cryptography.wasm"
$WasmScriptDir = Join-Path $ClientRoot "core\twelve_c_wasm"
$WebDir = Join-Path $ClientRoot "web"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

Set-Location $ClientRoot

Write-Step '安装 npm 依赖 (workspaces)'
if (-not (Test-Path (Join-Path $ClientRoot "node_modules"))) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} else {
    Write-Host 'node_modules 已存在，跳过 npm install'
}

if (-not $SkipTs) {
    & (Join-Path $ClientRoot "build-ts.ps1")
} else {
    Write-Host '已跳过 TypeScript 编译 (-SkipTs)'
}

if ($SetupEmsdk) {
    Write-Step '安装 Emscripten SDK (一次性)'
    $setupArgs = @()
    if ($EmsdkRoot) {
        $setupArgs += "-EmsdkRoot", $EmsdkRoot, "-SetEnv"
    } else {
        $setupArgs += "-SetEnv"
    }
    & (Join-Path $WasmScriptDir "setup-emsdk.ps1") @setupArgs
}

$needWasm = -not $SkipWasm -and ($ForceWasm -or -not (Test-Path $WasmPkg))

if ($needWasm) {
    Write-Step '编译 WASM -> transfer/src/wasm/pkg/'
    $buildArgs = @()
    if ($EmsdkRoot) {
        $buildArgs += "-EmsdkRoot", $EmsdkRoot
    }
    & (Join-Path $WasmScriptDir "build-wasm.ps1") @buildArgs
} elseif ($SkipWasm) {
    Write-Host '已跳过 WASM 编译 (-SkipWasm)'
} else {
    Write-Host "WASM 产物已存在: $WasmPkg (使用 -ForceWasm 可强制重编)"
}

Write-Step '复制 WASM -> web/public/wasm/'
Set-Location $WebDir
npm run copy:wasm
if ($LASTEXITCODE -ne 0) { throw "copy:wasm failed" }

if ($Production) {
    Write-Step 'Vite 生产构建 -> web/dist/'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Vite production build failed" }
    Write-Host ''
    Write-Host "完成。静态产物: $WebDir\dist\" -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'Client 构建完成。启动开发服务器:' -ForegroundColor Green
    Write-Host '  cd client' -ForegroundColor Gray
    Write-Host '  .\start.ps1' -ForegroundColor Gray
    Write-Host '  (或 cd web 后 npm run dev)' -ForegroundColor Gray
}
