# 12C Client

浏览器端与 TypeScript 传输层（npm workspaces：`transfer` / `app` / `web`），加密核心来自 `core/twelve_c_wasm`（Emscripten）或 `core/12c_file_transfer_scheme`（原生 C++）。

实现结构、V2/V2.1 状态、WASM API 与部署约束见 **[core/README.md](core/README.md)**；协议规范见 [docs/12C-Transfer-Protocol.zh.md](../docs/12C-Transfer-Protocol.zh.md)。

## 构建脚本一览

同步仓库后，**以下脚本应存在于 `client/` 树中**。若缺失，从版本库恢复或对照本表检查路径。

### 推荐入口（`client/` 根目录）

| 脚本 | 平台 | 作用 |
|------|------|------|
| [`build.ps1`](build.ps1) | Windows | 一键：`npm install` → `build-ts` → WASM（若缺）→ `copy:wasm` → 可选 `-Production` |
| [`build.sh`](build.sh) | Unix | 同上 |
| [`build-ts.ps1`](build-ts.ps1) | Windows | 仅编译 `transfer` / `app` TypeScript → `dist/` |
| [`build-ts.sh`](build-ts.sh) | Unix | 同上 |
| [`start.ps1`](start.ps1) | Windows | 构建（如需）+ 启动 Vite dev |
| [`start.sh`](start.sh) | Unix | 同上 |

等效 npm（在 `client/` 目录）：

```bash
npm run build          # → build.ps1（ts + wasm + copy）
npm run build:sh       # → build.sh
npm run build:ts       # → build-ts.ps1（仅 TypeScript）
npm run build:ts:sh    # → build-ts.sh
npm run build:prod     # → build.ps1 -Production
npm run start          # → start.ps1
npm run start:sh       # → start.sh
npm run build:wasm     # → twelve_c_wasm/build-wasm.ps1（仅 WASM）
npm run setup:emsdk    # → twelve_c_wasm/setup-emsdk.ps1
npm run build:native   # → core/build-native.ps1
```

### Web UI（`client/web/`）

| 脚本 | 作用 |
|------|------|
| [`start.ps1`](web/start.ps1) / [`start.sh`](web/start.sh) | 仅启动 dev（假定已构建） |
| [`scripts/copy-wasm.mjs`](web/scripts/copy-wasm.mjs) | 复制 WASM 到 `public/wasm/`（`predev` / `prebuild` 自动调用） |

### WASM / Emscripten（`client/core/twelve_c_wasm/`）

| 脚本 | 作用 |
|------|------|
| [`setup-emsdk.ps1`](core/twelve_c_wasm/setup-emsdk.ps1) / [`.sh`](core/twelve_c_wasm/setup-emsdk.sh) | 一次性安装 emsdk |
| [`build-wasm.ps1`](core/twelve_c_wasm/build-wasm.ps1) / [`.sh`](core/twelve_c_wasm/build-wasm.sh) | 编译 WASM → `transfer/src/wasm/pkg/` |
| [`build-openssl-emscripten.ps1`](core/twelve_c_wasm/build-openssl-emscripten.ps1) / [`.sh`](core/twelve_c_wasm/build-openssl-emscripten.sh) | 交叉编译 OpenSSL（通常由 build-wasm 自动调用） |

### 原生 C++ 验证（`client/core/`）

桌面 toolchain 下的**可选**编译检查，**不能替代** WASM 构建，也不参与 `:8080` / `:5173` 部署流水线。

| 脚本 | 作用 |
|------|------|
| [`build-native.ps1`](core/build-native.ps1) / [`.sh`](core/build-native.sh) | CMake 编译 → 仓库根 `build-test/native/` |
| `npm run build:native` / `build:native:sh` | 同上（在 `client/` 目录） |

```powershell
cd client\core
.\build-native.ps1
```

需要本机 **CMake ≥ 3.20** 与 **OpenSSL 开发包**（系统 x86/amd64 版，非 Emscripten 交叉编译版）。

#### 与 WASM 构建的异同

| | **原生 C++**（`build-native`） | **WASM**（`build-wasm`） |
|---|--------------------------------|--------------------------|
| **目的** | 快速验证 C++ 能否在桌面环境编过 | 浏览器实际上线路径 |
| **工具链** | 系统 CMake + 编译器 | emsdk + `emcmake` / `em++` |
| **OpenSSL** | 系统安装的 `OpenSSL::Crypto` | `third_party/openssl-emscripten/libcrypto.a` |
| **编译的源码** | 见下表「重叠 / 独有」 | 见下表「重叠 / 独有」 |
| **产物** | 静态库（`build-test/native/`） | `twelve_c_cryptography.{js,wasm}` → `transfer/src/wasm/pkg/` |
| **JS/浏览器绑定** | 无 | `bindings.cpp`（embind） |
| **部署是否必需** | 否 | 是（改 `12c_cryptography` 后必须重编） |

**源码重叠（同一套 `.cpp`，改一处两边都应能编过）：**

| 模块 | 路径 |
|------|------|
| 密码学核心 | `core/12c_file_transfer_scheme/12c_cryptography/src/*.cpp` |

**仅原生包含：**

| 模块 | 路径 | 说明 |
|------|------|------|
| 接收协议调度 | `core/12c_file_transfer_scheme/12c_receive_protocol/` | 下载计划等；浏览器侧由 TypeScript 会话层实现，**不进 WASM** |

**仅 WASM 包含：**

| 模块 | 路径 | 说明 |
|------|------|------|
| Emscripten 绑定 | `core/twelve_c_wasm/bindings.cpp` | 导出 `prepareUpload`、`receiveFromUploadMap` 等给 TS |

**何时用哪个：**

| 场景 | 用 |
|------|-----|
| 改 `12c_cryptography`，想快查语法/链接、本机有 OpenSSL | `build-native.ps1`（可选） |
| 改 `12c_cryptography` 或 `bindings.cpp`，要在浏览器里跑通 | `build-wasm.ps1` 或 `build.ps1 -ForceWasm`（**必须**） |
| 功能 roundtrip 验证 | 浏览器 `?selftest=roundtrip` 或实际上传/下载（走 WASM，不走 native） |

详见 [core/README.md](core/README.md) 与 [core/twelve_c_wasm/README.md](core/twelve_c_wasm/README.md)。
### Transfer npm 快捷方式（`client/transfer/`）

与 `twelve_c_wasm` 脚本等价，可在 `client/transfer` 目录执行：

- `npm run build:wasm` / `build:wasm:sh`
- `npm run setup:emsdk` / `setup:emsdk:sh`
- `npm run build:openssl:wasm` / `build:openssl:wasm:sh`

## 部署与脚本执行顺序

Client 有两种入口：**Registry 托管生产包**（`:8080`，推荐联调/穿透）与 **Vite 开发服务器**（`:5173`，改前端时用）。  
全栈（Registry → Relay → Console → 审批入池）见仓库根目录 [`HOW_TO_SETUP.md`](../HOW_TO_SETUP.md)；下文只说明 **Client 侧** 在各类场景下应跑哪些脚本、顺序如何。

### 生产部署（Registry `:8080`）

Registry 静态托管 `client/web/dist/`。典型顺序：

| 步骤 | 命令 | 说明 |
|------|------|------|
| **0**（首次） | `core/twelve_c_wasm/setup-emsdk.ps1 -EmsdkRoot C:\path\to\emsdk -SetEnv` | 安装 emsdk 并写入用户 `EMSDK`；详见 [core/twelve_c_wasm/README.md](core/twelve_c_wasm/README.md) |
| **1**（首次或改 C++/WASM） | `.\build.ps1 -Production` | `npm install` → `build-ts` → WASM（若缺）→ `copy:wasm` → `vite build` → 输出 `web/dist/` |
| **1'**（仅改 TS/UI） | `.\build.ps1 -Production -SkipWasm` | 跳过 WASM，加快前端迭代 |
| **1''**（仅改 C++） | `.\build.ps1 -Production -SkipTs -ForceWasm` | 只重编 WASM 并打生产包 |
| **2** | 重启 Registry | `cd server\registry` → `.\start.ps1`（或 Console 侧边栏重启） |
| **3** | 浏览器 | 打开 `http://127.0.0.1:8080`，必要时 **Ctrl+F5** 硬刷新 |

`build.ps1 -Production` 内部顺序固定为：

```text
npm install（若缺 node_modules）
  → build-ts.ps1          # transfer + app → dist/
  → build-wasm.ps1        # 若 pkg 无 .wasm 或 -ForceWasm
  → web: copy:wasm        # pkg → web/public/wasm/
  → web: vite build       # → web/dist/
```

服务端需已启动且 Relay 已入池；否则上传会失败（与 Client 构建无关）。

### 开发调试（Vite `:5173`）

| 步骤 | 命令 | 说明 |
|------|------|------|
| **1**（首次） | `.\build.ps1 -SetupEmsdk -EmsdkRoot C:\path\to\emsdk` | 等同安装 emsdk + 完整 Client 构建（不含 `dist/`） |
| **1**（日常） | `.\build.ps1` | TS + WASM（若缺）+ `copy:wasm`；**不**生成 `web/dist/` |
| **2** | `.\start.ps1` | 启动 Vite → `http://127.0.0.1:5173` |
| **3** | 确保 Registry `:8080` 在线 | `relay.config.json` 仍指向 Registry API |

改代码后的最小重编：

| 改动范围 | 命令 |
|----------|------|
| 仅 TypeScript / Vue | `.\build-ts.ps1`，然后刷新 Vite（或重启 `start.ps1`） |
| 仅 C++ / `bindings.cpp` | `.\build.ps1 -SkipTs -ForceWasm` |
| TS + WASM 都改 | `.\build.ps1 -ForceWasm` |

### 按场景速查

```text
首次本机（生产入口）
  setup-emsdk -SetEnv  →  server/start-all  →  Console 审批 Relay
  →  client/build.ps1 -Production  →  重启 Registry  →  :8080

日常改前端（开发入口）
  client/build.ps1  →  client/start.ps1  →  :5173

更新已部署的 Client（:8080）
  client/build.ps1 -Production  →  重启 Registry  →  浏览器硬刷新

仅重编 WASM
  client/core/twelve_c_wasm/build-wasm.ps1
  或 client/build.ps1 -SkipTs -ForceWasm
```

已设置用户级 `EMSDK` 后，上述 `build.ps1` / `build-wasm.ps1` 可省略 `-EmsdkRoot`。

## 快速开始

```powershell
cd client

# 首次：emsdk + 开发构建
.\build.ps1 -SetupEmsdk -EmsdkRoot C:\path\to\emsdk
.\start.ps1                    # 开发 → http://127.0.0.1:5173

# 生产包（Registry :8080）
.\build.ps1 -Production        # 然后重启 Registry
```

完整联调说明见仓库根目录 [`HOW_TO_SETUP.md`](../HOW_TO_SETUP.md)。

## 二维码接收链接

发送方可在上传前选择 **1 秒至 24 小时**的有效期。有效期从 Registry 预留上传位置时开始计算；如果 Relay 容量不足，Registry 可能下调时长，发送页会展示服务器实际授予值。只有文件上传成功后，客户端才会生成二维码和接收链接：

```text
https://<registry-base>/#v=1&receive=<credential>
```

接收方扫码后会打开 Registry 托管的客户端，自动下载并解密文件，然后尝试保存。如果浏览器拦截自动保存，可点击页面中的文件条完成保存。

二维码等同于完整的 bearer credential，可在过期前重复使用。请只通过私密渠道分享，不要发布到公开页面。凭证位于 URL fragment 中，不会随 HTTP 请求发送给服务器，但仍可能保留在扫码记录、浏览器历史或截图中。

公网部署应使用 HTTPS。到期限制由 Registry 和标准客户端接收流程保证；如果接收方已提前缓存 Relay 路由并绕过 Registry，本功能不承诺 Relay 侧硬过期。
