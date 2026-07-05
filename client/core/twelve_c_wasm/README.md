# [12C] twelve_c WASM Build / twelve_c WASM 构建

Emscripten bindings for the 12C cryptography core. Scripts install the toolchain, cross-compile OpenSSL for WASM, build `twelve_c_cryptography`, and copy artifacts into the TypeScript transfer package.

12C 密码学核心的 Emscripten 绑定。脚本负责安装工具链、为 WASM 交叉编译 OpenSSL、构建 `twelve_c_cryptography`，并将产物复制到 TypeScript transfer 包。

---

## Quick start / 快速开始

### Windows (PowerShell)

```powershell
# Step 1 — once: install emsdk
.\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk -SetEnv

# Step 2 — if OpenSSL build fails on Perl: install Strawberry Perl
# https://strawberryperl.com/

# Step 3 — build (OpenSSL + WASM; re-run anytime)
.\build-wasm.ps1
```

### Linux / macOS / WSL (Bash)

```bash
# Step 1 — once
./setup-emsdk.sh /opt/emsdk
source /opt/emsdk/emsdk_env.sh

# Step 2 — build
./build-wasm.sh
```

### npm (from `client/transfer`)

```bash
npm run setup:emsdk        # Windows: setup-emsdk.ps1
npm run setup:emsdk:sh     # Unix: setup-emsdk.sh
npm run build:wasm         # Windows: build-wasm.ps1
npm run build:wasm:sh      # Unix: build-wasm.sh
npm run build:openssl:wasm # Windows only: rebuild OpenSSL for Emscripten
```

---

## Script order / 脚本顺序

| Step         | Script                                     | When                    | 说明                                                   |
| ------------ | ------------------------------------------ | ----------------------- | ------------------------------------------------------ |
| **1**  | `setup-emsdk.ps1` / `setup-emsdk.sh`   | Once per machine        | 克隆并安装 emsdk + Emscripten                          |
| **2**  | *(manual)* Install Perl on Windows       | If step 3 fails on Perl | Strawberry 或 MSYS2 perl                               |
| **2b** | `build-openssl-emscripten.ps1` / `.sh` | Auto or manual          | 交叉编译 OpenSSL →`third_party/openssl-emscripten/` |
| **3**  | `build-wasm.ps1` / `build-wasm.sh`     | Every WASM rebuild      | CMake + em++ → copy to transfer pkg                   |

`build-wasm` **automatically** runs `build-openssl-emscripten` when `libcrypto.a` is missing.

`build-wasm` 在缺少 `libcrypto.a` 时会**自动**调用 `build-openssl-emscripten`。

---

## Tool versions / 工具版本

Versions below were verified on Windows with emsdk `latest` (Emscripten **6.0.2**). Other patch versions of the same major line usually work.

以下版本在 Windows + emsdk `latest`（Emscripten **6.0.2**）上验证通过。同主版本的相近补丁版通常可用。

| Component                      | Version / requirement                      | Notes                                                                            |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **Emscripten**           | **6.0.x** (`emsdk install latest`) | 6.0 removed`.bat` launchers; scripts detect `emcmake.exe` / `emcc.exe`     |
| **emsdk bundled Node**   | 22.x                                       | Used by emsdk internally                                                         |
| **emsdk bundled Python** | 3.13.x                                     | Used by`emsdk install`                                                         |
| **OpenSSL (WASM)**       | **1.1.1w** (default)                 | Static`libcrypto.a`; 3.x needs fuller Perl (avoid Git MSYS Perl)               |
| **CMake**                | **≥ 3.20**                          | System install; invoked via`emcmake`                                           |
| **Perl (Windows)**       | Strawberry or MSYS2                        | Must provide`Pod::Usage`; **Git `usr\bin\perl.exe` is not sufficient** |
| **Perl (Unix)**          | System`perl` ≥ 5.10                     | For OpenSSL`Configure`                                                         |
| **Git**                  | Any recent                                 | Clone emsdk and OpenSSL source                                                   |
| **tar (Windows)**        | `C:\Windows\System32\tar.exe`            | **Required by `build-openssl-emscripten.ps1`** — see mitigations section below |
| **make (Windows)**       | mingw32-make                               | OpenSSL build via`emmake`                                                      |
| **PowerShell**           | ≥ 5.1                                     | For`.ps1` scripts                                                              |
| **Disk**                 | ~2 GB+ free                                | emsdk + OpenSSL sources and build trees                                          |

---

## Output paths / 产物路径

| Artifact                      | Path                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| WASM deliverables (JS + WASM) | `client/transfer/src/wasm/pkg/twelve_c_cryptography.{js,wasm}` |
| OpenSSL for Emscripten        | `client/core/twelve_c_wasm/third_party/openssl-emscripten/`    |
| Local CMake build tree        | `client/core/twelve_c_wasm/build/`                             |
| emsdk install root            | User-chosen, e.g.`P:\_Tools\emsdk` or `%USERPROFILE%\emsdk`  |

**Important:** The correct path includes **`src`**. Do **not** use `client/transfer/wasm/pkg/` — that path is wrong and not referenced by `loader.ts`.

**注意：** 正确路径包含 **`src`**。不要使用 `client/transfer/wasm/pkg/`——该路径错误，`loader.ts` 也不会引用它。

TypeScript loads WASM via:

```ts
// client/transfer/src/wasm/loader.ts
import('./pkg/twelve_c_cryptography.js')
```

---

## Script reference / 脚本说明

### `setup-emsdk.ps1` / `setup-emsdk.sh`

Installs and activates Emscripten SDK.

安装并激活 Emscripten SDK。

```powershell
.\setup-emsdk.ps1                              # default: %USERPROFILE%\emsdk
.\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk   # custom location (-InstallRoot alias)
.\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk -SetEnv  # persist EMSDK user env var
```

```bash
./setup-emsdk.sh
./setup-emsdk.sh /opt/emsdk
./setup-emsdk.sh /opt/emsdk --set-env   # append EMSDK to ~/.bashrc / ~/.zshrc
```

After setup, activate in the **current shell** before manual `emcc` use:

安装完成后，若需在当前 shell 手动使用 `emcc`：

```powershell
. "P:\_Tools\emsdk\emsdk_env.ps1"
```

```bash
source /opt/emsdk/emsdk_env.sh
```

### `build-openssl-emscripten.ps1` / `build-openssl-emscripten.sh`

Cross-compiles OpenSSL **1.1.1w** to a static `libcrypto.a` for Emscripten. Usually invoked by `build-wasm`; run standalone to rebuild OpenSSL only.

为 Emscripten 交叉编译 OpenSSL **1.1.1w** 静态库 `libcrypto.a`。通常由 `build-wasm` 调用；也可单独重编 OpenSSL。

```powershell
.\build-openssl-emscripten.ps1
.\build-openssl-emscripten.ps1 -PerlPath 'C:\Strawberry\perl\bin\perl.exe'
.\build-openssl-emscripten.ps1 -OpenSslVersion 1.1.1w
```

```bash
./build-openssl-emscripten.sh
OPENSSL_VERSION=1.1.1w ./build-openssl-emscripten.sh
```

### `build-wasm.ps1` / `build-wasm.sh`

Configures with `emcmake`, builds with `em++`, copies artifacts to transfer pkg.

使用 `emcmake` 配置、`em++` 编译，并将产物复制到 transfer pkg。

```powershell
.\build-wasm.ps1
.\build-wasm.ps1 -EmsdkRoot P:\_Tools\emsdk
```

```bash
./build-wasm.sh
EMSDK=/opt/emsdk ./build-wasm.sh
./build-wasm.sh /opt/emsdk
```

To force a clean WASM rebuild:

强制完整重编 WASM：

```powershell
Remove-Item -Recurse -Force .\build -ErrorAction SilentlyContinue
.\build-wasm.ps1
```

---

## Known limitations / 脚本无法自动解决的问题

### English

The automation **does not** fully handle these issues — manual action is required.

| Issue | Symptom | Manual fix |
|-------|---------|------------|
| Large emsdk download corruption | `File is not a zip file` during `emsdk install` | Delete `emsdk/downloads/*wasm-binaries*`, re-run `setup-emsdk` or `emsdk install latest` |
| Git bundled Perl (incomplete modules) | `Pod::Usage` / `Locale::Maketext::Simple` not found | Install [Strawberry Perl](https://strawberryperl.com/) or MSYS2 `perl`; pass `-PerlPath` |
| No Emscripten OpenSSL port in 6.x | `-sUSE_OPENSSL=1` is invalid | OpenSSL must be cross-compiled separately (`build-openssl-emscripten`; adds build time) |
| Missing git / python / cmake | `Required command not found` | Install prerequisites before running scripts |
| Unstable network or low disk space | Timeouts, partial extracts | Retry; ensure ≥ 2 GB free; use a stable network |
| Chinese locale + Git Perl | `Locale 'zh_CN.GBK' is unsupported` | Script sets `LC_ALL=C`; prefer Strawberry or MSYS2 Perl |
| Wrong WASM output path | Artifacts not found in transfer | Use `client/transfer/src/wasm/pkg/`, **not** `client/transfer/wasm/pkg/` |

### 中文

以下问题脚本**无法完全自动处理**，需要人工介入。

| 问题 | 现象 | 手动处理 |
|------|------|----------|
| emsdk 大文件下载损坏 | `emsdk install` 报 `File is not a zip file` | 删除 `emsdk/downloads/*wasm-binaries*`，重新运行 `setup-emsdk` 或 `emsdk install latest` |
| Git 自带 Perl 模块不全 | 缺少 `Pod::Usage`、`Locale::Maketext::Simple` 等 | 安装 [Strawberry Perl](https://strawberryperl.com/) 或 MSYS2 `perl`；或用 `-PerlPath` 指定 |
| Emscripten 6 无 OpenSSL port | `-sUSE_OPENSSL=1` 无效 | 必须单独交叉编译 OpenSSL（`build-openssl-emscripten`，耗时较长） |
| 缺少 git / python / cmake | `Required command not found` | 先安装依赖再运行脚本 |
| 网络不稳定或磁盘不足 | 超时、解压不完整 | 重试；预留 ≥ 2 GB 空间；使用稳定网络 |
| 中文 locale + Git Perl | `Locale 'zh_CN.GBK' is unsupported` | 脚本会设 `LC_ALL=C`；仍建议用 Strawberry 或 MSYS2 Perl |
| WASM 产物路径错误 | transfer 包找不到文件 | 正确路径为 `client/transfer/src/wasm/pkg/`，**不是** `client/transfer/wasm/pkg/` |

---

## Mitigated in scripts / 脚本已规避（其它场景仍可能发生)

These Windows/MSYS pitfalls are **handled by our PowerShell scripts**. They are **not** listed above as “unfixable”, but can **reappear** if you bypass the scripts or change the environment.

以下问题在**按文档跑 `.ps1` 脚本**时已被规避，不应再出现；若手动操作或换环境，仍可能再次遇到。

### English

| Pitfall | What the script does | Can still occur when |
|---------|----------------------|----------------------|
| Git MSYS `tar` + Windows `X:\` paths (any drive letter) | `build-openssl-emscripten.ps1` calls `System32\tar.exe` and extracts with a **relative** archive name inside `third_party/` | You manually run `tar -C D:\...` in Git Bash; `build-openssl-emscripten.sh` in **Git Bash on Windows** (uses MSYS `tar`); `System32\tar.exe` is missing |
| MSYS `sh` mangles `X:\...\emcc.exe` in Makefiles | After OpenSSL `Configure`, rewrites `CC`/`CXX`/`AR` to `emcc`/`em++`/`emar` | emsdk not on `PATH` during `emmake`; Makefile regenerated without re-running our script |

### 中文

| 问题 | 脚本如何处理 | 仍可能触发的情况 |
|------|--------------|------------------|
| Git MSYS `tar` 与 Windows `X:\` 路径（任意盘符） | `build-openssl-emscripten.ps1` 调用 `System32\tar.exe`，在 `third_party/` 内用**相对路径**解压 | 在 Git Bash 中手动 `tar -C D:\...`；在 **Windows Git Bash** 下跑 `build-openssl-emscripten.sh`；系统无 `System32\tar.exe` |
| MSYS `sh` 破坏 Makefile 中的 `X:\...\emcc.exe` | OpenSSL `Configure` 后将 `CC`/`CXX`/`AR` 改为 `emcc`/`em++`/`emar` | 编 OpenSSL 时 emsdk 不在 `PATH`；未通过本脚本重新生成 Makefile |

---

## Troubleshooting / 故障排查

### Emscripten not found

```powershell
$env:EMSDK = "P:\_Tools\emsdk"
. "$env:EMSDK\emsdk_env.ps1"
.\build-wasm.ps1
```

Or pass `-EmsdkRoot` / set user env with `setup-emsdk.ps1 -SetEnv`.

### OpenSSL Configure failed (Perl)

1. Install Strawberry Perl.
2. Re-run:

```powershell
.\build-openssl-emscripten.ps1 -PerlPath 'C:\Strawberry\perl\bin\perl.exe'
```

### Incomplete OpenSSL source tree

```powershell
Remove-Item -Recurse -Force .\third_party\openssl-1.1.1w -ErrorAction SilentlyContinue
.\build-openssl-emscripten.ps1
```

### Stale CMake cache after CMakeLists changes

```powershell
Remove-Item -Recurse -Force .\build -ErrorAction SilentlyContinue
.\build-wasm.ps1
```

---

## Directory layout / 目录结构

```
twelve_c_wasm/
├── README.md
├── setup-emsdk.ps1 / .sh
├── build-openssl-emscripten.ps1 / .sh
├── build-wasm.ps1 / .sh
├── CMakeLists.txt
├── bindings.cpp
├── build/                          # gitignored CMake output
└── third_party/                    # gitignored
    ├── openssl-1.1.1w/             # OpenSSL source (extracted)
    └── openssl-emscripten/         # cross-compiled headers + libcrypto.a
```

Deliverables copied to:

产物复制目标：

```
client/transfer/src/wasm/pkg/
├── twelve_c_cryptography.js
├── twelve_c_cryptography.wasm      # gitignored; must exist locally after build
└── twelve_c_cryptography.d.ts      # hand-maintained types
```

---

## Architecture note / 架构说明

- **C++ core:** `client/core/12c_file_transfer_scheme/12c_cryptography/`
- **WASM bindings:** this directory (`bindings.cpp` + CMake)
- **TypeScript consumer:** `client/transfer/src/wasm/loader.ts`

System OpenSSL (x86) cannot be linked into WASM. The WASM build uses a dedicated `libcrypto.a` produced by `build-openssl-emscripten`.

系统自带的 OpenSSL（x86）不能链接进 WASM。WASM 构建使用 `build-openssl-emscripten` 生成的专用 `libcrypto.a`。
