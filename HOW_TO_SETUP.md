# 12C 本地联调设置指南

本文说明如何在本地从零启动 **Registry → Relay → Console → Client Web**，完成 Relay 入池审批，并用浏览器发送 / 接收文件。

更细的服务端架构与 API 见 [`server/README.md`](server/README.md) 及各子目录 `README.md`。

---

## 架构概览

```
浏览器 (Client Web :5173)
    │  reserve / register / 下载
    ▼
Registry (:8080)  ──路由、凭证占用、Relay 心跳──►  Relay (:9090)  磁盘块存储
    ▲
Console (:8070)  统一控制面板：启停服务、Relay 入池、注册审批、数据库浏览
```

| 组件 | 默认地址 | 作用 |
|------|----------|------|
| Registry | `http://127.0.0.1:8080` | 元数据与路由；客户端只连 Registry |
| Relay | `http://127.0.0.1:9090` | 无状态块存储；由 Registry 分配 |
| Console | `http://127.0.0.1:8070` | 运维 UI + BFF 代理 |
| Client Web | `http://127.0.0.1:5173` | 浏览器端加密上传 / 下载 |

---

## 环境要求

| 依赖 | 版本 / 说明 |
|------|-------------|
| **Python** | 3.10+（各 `start.ps1` / `start.sh` 会自动创建 `.venv`） |
| **Node.js** | 18+（Client 使用 npm workspaces） |
| **Git** | 克隆仓库、WASM 构建时需要 |
| **WASM 构建**（可选，见下文） | Emscripten 6.0.x、CMake ≥ 3.20；Windows 另需 Strawberry Perl |

Windows 下推荐使用 **PowerShell**。Linux / macOS 使用各目录下的 `start.sh`。

---

## 快速启动（Windows）

### 1. 启动全部服务端

在仓库根目录：

```powershell
cd server
.\start-all.ps1
```

会在**新窗口**启动 Registry、Relay，并在**当前窗口**启动 Console。浏览器打开：

**http://127.0.0.1:8070**

首次运行各 `start.ps1` 会：

- 创建 Python 虚拟环境并安装依赖
- 从 `*.config.example.json` 复制配置文件
- 自动生成 `adminApiKey`、`blockAuthMasterKey` 等密钥（写入各服务的 `*.secrets.json`）

### 2. 注册并审批 Relay（首次必做）

Relay 默认**不会**自动入池。在 Console 中：

1. 左侧切换到 **Relay** 面板，确认服务在线（侧边栏也可一键启停 Registry / Relay）。
2. 点击 **向 Registry 注册**，Registry URL 填 `http://127.0.0.1:8080`（可用「填入本地 Registry」快捷按钮）。
3. 切换到 **Registry** 面板，点击右上角 **信封**（注册收件箱）。
4. 对待审批条目点击 **同意并指派**。

审批完成后，Registry 侧 Relay 卡片应显示为**在线**。此时客户端才能成功上传。

> 若 Relay 已在 Allowlist 中，注册按钮会提示「已在 Allowlist 中」，可跳过。

### 3. 构建 Client 并启动 Web

推荐使用 **`client/` 根目录的一键脚本**（详见 [Client 构建](#client-构建)）：

```powershell
cd client

# 首次：安装 emsdk 并构建（约需数分钟～数十分钟）
.\build.ps1 -SetupEmsdk -EmsdkRoot P:\_Tools\emsdk

# 之后日常：构建 + 启动开发服务器
.\start.ps1
```

或分步执行：

```powershell
cd client
.\build.ps1      # npm install → WASM（若缺失）→ copy:wasm
.\start.ps1      # 启动 Vite → http://127.0.0.1:5173
```

也可通过 npm 调用：`npm run build`、`npm run start`（在 `client/` 目录）。

浏览器打开 **http://127.0.0.1:5173**。

### 4. 验证收发

1. **发送**页：选择小文件 → 上传 → 复制 12 位凭证。
2. **接收**页：粘贴凭证 → 点击下载箭头 → 保存文件。
3. 若修改过协议或 WASM，请**重新上传**并 **Ctrl+F5 硬刷新** 浏览器。

---

## 分步启动（手动）

适合需要单独调试某一服务时使用。

### Registry

```powershell
cd server\registry
.\start.ps1
# → http://127.0.0.1:8080
```

### Relay（另开终端）

编辑 `server\relay\relay_server.config.json`，确保：

```json
"registry": {
  "url": "http://127.0.0.1:8080"
}
```

示例配置里 `registry.url` 可能仍为占位符 `https://registry.example.com`，本地联调**必须**改为本地 Registry 地址。

```powershell
cd server\relay
.\start.ps1
# → http://127.0.0.1:9090
```

### Console（另开终端）

```powershell
cd server\console
.\start.ps1
# → http://127.0.0.1:8070
```

`console_server.config.json` 默认已指向本地 Registry / Relay。Console 启动时会从各服务的 `*.secrets.json` **自动同步** Admin API Key，一般无需手填。

### Client Web

推荐使用自动化脚本（见 [Client 构建 — 自动化脚本](#自动化脚本推荐)）：

```powershell
cd client
.\start.ps1      # 缺 WASM 时会自动调用 build.ps1
```

或仅启动 dev（须已构建）：

```powershell
cd client\web
.\start.ps1
# → http://127.0.0.1:5173
```

---

## Client 构建

Client 为 **npm workspaces** 单体仓库，浏览器 UI 依赖 TypeScript 业务层与 C++ WASM 加密核心。  
**推荐始终从 `client/` 根目录使用自动化脚本**，无需手动切换 `core/twelve_c_wasm`、`web` 等子目录。

### 自动化脚本（推荐）

| 脚本 | 平台 | 作用 |
|------|------|------|
| [`client/build.ps1`](client/build.ps1) | Windows | 一键构建：`npm install` → WASM（若缺失）→ `copy:wasm` |
| [`client/build.sh`](client/build.sh) | Linux / macOS | 同上 |
| [`client/start.ps1`](client/start.ps1) | Windows | 构建（如需）+ 启动 Vite 开发服务器 |
| [`client/start.sh`](client/start.sh) | Linux / macOS | 同上 |

等效 npm 命令（在 `client/` 目录）：

| npm 命令 | 说明 |
|----------|------|
| `npm run build` | 调用 `build.ps1` |
| `npm run build:sh` | 调用 `build.sh` |
| `npm run build:prod` | 构建并输出 `web/dist/` |
| `npm run start` | 调用 `start.ps1` |
| `npm run start:sh` | 调用 `start.sh` |

#### 常用场景

```powershell
cd client

# ① 首次克隆：安装 emsdk + 完整构建
.\build.ps1 -SetupEmsdk -EmsdkRoot P:\_Tools\emsdk

# ② 日常开发：自动检测并构建，然后启动
.\start.ps1

# ③ 仅重新编译 WASM（C++ 变更后）
.\build.ps1 -ForceWasm

# ④ 生产静态站点
.\build.ps1 -Production
# 或：npm run build:prod
```

```bash
cd client

# 首次
./build.sh --setup-emsdk /opt/emsdk

# 日常
./start.sh

# 强制重编 WASM
./build.sh --force-wasm

# 生产构建
./build.sh --production
```

#### `build.ps1` / `build.sh` 参数

| 参数 | 说明 |
|------|------|
| `-SetupEmsdk` / `--setup-emsdk` | 构建前先安装 Emscripten（一次性） |
| `-EmsdkRoot` / `--emsdk-root` | emsdk 安装目录 |
| `-SkipWasm` / `--skip-wasm` | 跳过 WASM，仅 install + copy（须已有 pkg 产物） |
| `-ForceWasm` / `--force-wasm` | 强制重编 WASM |
| `-Production` / `--production` | 额外执行 `vite build` → `web/dist/` |

脚本会在 `transfer/src/wasm/pkg/twelve_c_cryptography.wasm` **已存在**时跳过 WASM 编译；修改 C++ 后使用 `-ForceWasm` / `--force-wasm`。

WASM 重编或 copy 后，浏览器请 **Ctrl+F5 硬刷新**。

### 包结构

```
client/
├── build.ps1 / build.sh      # ★ 一键构建（推荐入口）
├── start.ps1 / start.sh      # ★ 构建 + 启动 dev
├── package.json              # workspaces 根；npm run build / start
├── core/twelve_c_wasm/       # C++ 源码 + Emscripten 底层脚本（由 build.ps1 调用）
├── transfer/                 # @stateless-relay/transfer — 协议、会话、WASM loader
│   └── src/wasm/pkg/         # build-wasm 产物目录（.wasm 不入库）
├── app/                      # @stateless-relay/app — 上传/下载编排、凭证生成
└── web/                      # @stateless-relay/web — Vite 前端
    ├── public/wasm/          # copy:wasm 目标（dev / build 运行时加载）
    ├── start.ps1 / start.sh  # 仅启动 dev（假定已构建）
    └── scripts/copy-wasm.mjs
```

依赖关系：`web` → `app` → `transfer` → WASM 二进制。`vite.config.ts` 在开发时将 `@stateless-relay/transfer` / `@stateless-relay/app` **直接 alias 到源码**（`../transfer/src`、`../app/src`），因此改 TS 后无需先 `tsc`，保存即热更新。

### 构建顺序（脚本内部流程）

`build.ps1` / `build.sh` 按以下顺序执行：

```
① npm install（client/ 根目录）
② build-wasm.ps1 / .sh  →  client/transfer/src/wasm/pkg/   （若 .wasm 缺失或 -ForceWasm）
③ npm run copy:wasm     →  client/web/public/wasm/
④ npm run build         →  client/web/dist/                 （仅 -Production）
```

**手动分步构建**（调试 WASM 工具链时使用）：

```powershell
cd client\core\twelve_c_wasm
.\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk -SetEnv   # 一次性
.\build-wasm.ps1
cd ..\..
.\build.ps1 -SkipWasm    # 仅 install + copy，不再编 WASM
```

### 开发模式

| 命令 | 目录 | 说明 |
|------|------|------|
| `.\start.ps1` | `client/` | **推荐**：自动构建 + 启动 Vite |
| `npm run dev` | `client/web/` | `predev` 先 `copy:wasm`，再启动 Vite（:5173） |
| `npm run typecheck` | 各 workspace | TypeScript 检查 |

`web/start.ps1` 会在缺少 `node_modules` 时自动在 `client/` 执行 `npm install`；**不会**自动编 WASM，请优先使用 `client/start.ps1`。

### 生产构建

```powershell
cd client
.\build.ps1 -Production
# 或：npm run build:prod

cd web
npm run preview    # 本地预览 dist/
```

产物在 `client/web/dist/`：`index.html`、打包后的 JS/CSS，以及 `dist/wasm/twelve_c_cryptography.{js,wasm}`。

部署时将整个 `dist/` 目录作为静态站点根目录即可；记得按环境修改 `relay.config.json` 中的 Registry URL。

### WASM 底层脚本

加密核心为 Emscripten 产物，**`.wasm` 不入 Git**；`build.ps1` 会在缺失时自动调用下列脚本。也可单独运行（排查工具链问题时）：

#### Windows

```powershell
cd client\core\twelve_c_wasm
.\setup-emsdk.ps1 -EmsdkRoot P:\_Tools\emsdk -SetEnv   # 一次性；或由 build.ps1 -SetupEmsdk 触发
.\build-wasm.ps1                                         # 若 OpenSSL 报 Perl 错：安装 Strawberry Perl
```

#### npm 快捷方式（`client/transfer`）

```powershell
cd client\transfer
npm run build:wasm        # Windows → build-wasm.ps1
npm run build:wasm:sh     # Unix → build-wasm.sh
```

#### 产物路径（易错）

| 正确 | 错误（勿用） |
|------|--------------|
| `client/transfer/src/wasm/pkg/twelve_c_cryptography.{js,wasm}` | `client/transfer/wasm/pkg/` |

`loader.ts` 通过 `import('./pkg/twelve_c_cryptography.js')` 引用；路径少了 `src` 会导致模块找不到。

#### 浏览器如何加载 WASM

Emscripten 胶水代码**不由 Vite 打包**，而是运行时单独加载，避免打包器改写 `createTwelveCModule` 与 `.wasm` 路径：

1. `runtime.ts` 用 `<script src="/wasm/twelve_c_cryptography.js">` 注入全局工厂；
2. `loadTwelveC` 传入 `wasmUrl: '/wasm/twelve_c_cryptography.wasm'` 定位二进制；
3. `copy-wasm.mjs` 将 `transfer/src/wasm/pkg/` 复制到 `web/public/wasm/`，供 dev server 与 `dist/` 使用。

因此 `npm run dev` 前必须存在 `transfer/src/wasm/pkg/twelve_c_cryptography.wasm`，否则 `copy:wasm` 会报 **ENOENT**。

详细工具版本与 OpenSSL / Perl 排错见 [`client/core/twelve_c_wasm/README.md`](client/core/twelve_c_wasm/README.md)。

> **注意**：请使用 `build-wasm.ps1` 完整脚本，不要手动拼接 `emcmake` 命令；PowerShell 对 `$变量` 的解析容易导致路径错误。

### Client 构建常见问题

#### `copy:wasm` / `ENOENT: twelve_c_cryptography.wasm`

尚未构建 WASM。在 `client/` 运行 `.\build.ps1`（或首次加 `-SetupEmsdk`），不要只跑 `web/npm run dev`。

#### 页面报 `failed to load /wasm/twelve_c_cryptography.js`

- `public/wasm/` 缺少文件：运行 `cd client/web && npm run copy:wasm`；
- 仅存在 `.js` 而无 `.wasm`：WASM 未构建完整，重新 `build-wasm.ps1`；
- 浏览器缓存旧胶水：硬刷新（Ctrl+F5）。

#### `global createTwelveCModule missing`

`.js` 已加载但未暴露全局工厂，多为 **JS 与 `.wasm` 版本不一致**（只复制了其一）。删除 `public/wasm/` 后重新 `copy:wasm`，并硬刷新。

#### `npm install` 后仍找不到 `@stateless-relay/*`

须在 **`client/` 根目录**执行 `npm install`，不要在单独的 `web/` 目录单独装包（workspaces 链接在根目录解析）。

#### 修改 `transfer` / `app` 源码后不生效

确认 Vite dev server 在运行；生产环境须重新 `npm run build`。若直接消费 `dist/` 的下游项目，还需在对应包内执行 `npm run build`（`tsc`）。

#### WASM / 解密报错、`TextDecoder` / `resizable ArrayBuffer`

Emscripten 6.x 与旧产物不兼容。运行 `.\build.ps1 -ForceWasm`，再硬刷新；勿混用其他目录下的 `.wasm`。

---

## 配置说明

### Client — Registry 地址

默认读取 `client/web/public/relay.config.json`：

```json
{
  "registry": {
    "url": "http://127.0.0.1:8080"
  }
}
```

Web UI **设置**页可覆盖为本地存储的 Registry URL（优先级高于上述文件）。

### Client — 设置页选项

| 选项 | 说明 |
|------|------|
| **Registry URL** | 客户端连接的 Registry 根地址 |
| **文件有效时间** | 上传时传给 Registry 的 TTL（时 / 分 / 秒，合计最高 24 小时） |
| **凭证风格** | 大写 / 小写、单词风格（CVC 音节）、横杠位置、字母限位等；影响生成的 12 位带外凭证样式 |

设置保存在浏览器 `localStorage`，修改后需点 **确认保存**。

### Relay — 关键字段

| 字段 | 本地建议值 |
|------|------------|
| `publicBaseUrl` | `http://127.0.0.1:9090` |
| `registry.url` | `http://127.0.0.1:8080` |
| `registry.autoRegisterOnStartup` | 默认 `false`；保持关闭，通过 Console 手动注册更安全 |

### Registry — 关键字段

| 字段 | 说明 |
|------|------|
| `heartbeatUrlPolicy` | 默认 `sync_if_unset`：首次 heartbeat 自动写入 Relay URL |
| `stripeTargetRelays` | 条带化目标 Relay 数量（默认 3） |
| `maxFileReplicaCount` | 单文件 replica 数上限 |

密钥类字段（`adminApiKey`、`blockAuthMasterKey`）首次启动时自动生成，勿提交到版本库。

---

## Linux / macOS

各服务目录均有 `start.sh`，用法与 PowerShell 脚本等价：

```bash
cd server/registry && ./start.sh    # 8080
cd server/relay && ./start.sh       # 9090
cd server/console && ./start.sh     # 8070

cd client && ./start.sh             # 构建（如需）+ Web :5173
```

Client 构建详见 [自动化脚本](#自动化脚本推荐)。

---

## 常见问题

### 上传失败：`PUT failed after 3 attempts`

- Registry reserve 成功但 Relay 无对应块，多为 **Relay 未入池或未在线**。
- 在 Console Registry 面板确认 Relay 状态为在线；重新完成 [注册并审批 Relay](#2-注册并审批-relay首次必做)。

### HTTP 413 Payload Too Large

- 单块上限由 Relay `maxBodyBytes` 控制（默认 16 MB）。
- 大文件会被切分为多块；若仍 413，检查是否使用了过旧的前端或 Relay 未更新。

### WASM / 解密报错

见 [Client 构建常见问题](#client-构建常见问题) 中 WASM 相关条目。

### Console 无法管理 Registry / Relay

- 确认对应服务已启动且端口未被占用。
- Admin Key 由 `*.secrets.json` 自动同步；若手动改过配置，重启 Console。

### Relay 心跳 409 / URL 不一致

- `relayBaseUrl` 须与 Allowlist 中记录一致（默认策略下去尾斜杠后比较）。
- 在 Console 中更新 Allowlist 条目 URL，或修正 Relay `publicBaseUrl`。

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [`server/README.md`](server/README.md) | 服务端总览与端口 |
| [`server/registry/README.md`](server/registry/README.md) | Registry API、Allowlist |
| [`server/relay/README.md`](server/relay/README.md) | Relay 密钥与块存储 |
| [`server/console/README.md`](server/console/README.md) | 控制面板功能 |
| [`client/web/README.md`](client/web/README.md) | Web UI 与 copy:wasm 说明 |
| [`client/core/twelve_c_wasm/README.md`](client/core/twelve_c_wasm/README.md) | WASM 构建细节 |
