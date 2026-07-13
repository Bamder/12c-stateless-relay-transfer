# 12C Client Core

本目录为 **12C 密码学与 Wire 布局的参考实现**（C++），通过 Emscripten 编译为浏览器 WASM，供 `client/transfer` 调用。

**协议规范（RFC 风格，与实现分离）：**

- 中文：[docs/12C-Transfer-Protocol.zh.md](../../docs/12C-Transfer-Protocol.zh.md)
- English：[docs/12C-Transfer-Protocol.en.md](../../docs/12C-Transfer-Protocol.en.md)

本文档记录**源码结构、构建方式、应用层策略与部署相关细节**；线速比特布局以协议文档为准。

---

## 目录结构

```text
client/core/
├── README.md                          # 本文件
├── build-native.ps1 / .sh             # 桌面 OpenSSL 原生编译（验证用）
├── 12c_file_transfer_scheme/
│   ├── 12c_cryptography/              # SMB、加解密、Wire、Merkle
│   └── 12c_receive_protocol/          # 接收侧调度（下载计划）
└── twelve_c_wasm/
    ├── bindings.cpp                   # Emscripten ↔ TypeScript 绑定
    ├── build-wasm.ps1 / .sh           # WASM 构建与复制到 transfer
    └── README.md                      # emsdk / OpenSSL / 故障排查（详）
```

---

## 分层职责

| 层 | 位置 | 职责 |
|----|------|------|
| **协议** | `docs/12C-Transfer-Protocol.*.md` | 线速格式、SMB、V2/V2.1 语义 |
| **密码学原语** | `12c_cryptography/` | 显式 `segment_code` 下的加解密、SMB 序列化、Wire 切分 |
| **应用策略** | `client/transfer/src/segment-policy.ts` | 16 MiB 分界、默认 `segment_code`、校验与解码辅助 |
| **会话编排** | `client/transfer/src/session/` | `prepareUpload` / `uploadFile`、Registry reserve、Relay PUT |
| **WASM 绑定** | `twelve_c_wasm/bindings.cpp` | `prepareUpload`、`receiveFromUploadMap`、`parseSmbEncrypted` |

密码学层**不**根据文件大小自动选择 V2 / V2.1；调用方必须传入 `segment_code`（应用层默认用 `selectSegmentCodeForFileSize`）。

---

## 协议版本与实现状态

| 版本 | `segment_code` | 密码学层 | 应用层策略 | 备注 |
|------|----------------|----------|------------|------|
| **V2** | `0` | 已实现 | 默认 ≤16 MiB | 与早期线速兼容 |
| **V2.1** | `1`..`5` | 已实现 | 默认 >16 MiB 用 `4`（128 MiB 段） | SMB `version` 仍为 `2` |

**已知限制：** 大于 16 MiB 的文件走 **流式** `prepareUploadStreaming`：按 `segment_code` 对应的 **GCM 明文段大小**切片读文件并 feed WASM（与 `selectSegmentCodeForFileSize` 相同，默认大文件 `segment_code=4` → 128 MiB 段）。WASM 在 `segment_buffer` 攒满一段后加密，峰值约为 **一个 GCM 段 + 一个 wire 块**。`reserve` 前仍需完整 `UploadMap`。

---

## 源码对照（实现地图）

| 组件 | 路径 |
|------|------|
| 协议常量 | `12c_cryptography/include/twelve_c/constants.hpp` |
| V2 / V2.1 分段原语 | `12c_cryptography/include/twelve_c/segment.hpp`、`src/segment.cpp` |
| SMB 读写 | `12c_cryptography/src/smb.cpp` |
| Wire 布局 | `12c_cryptography/src/wire_layout.cpp` |
| 发送 | `12c_cryptography/src/sender.cpp` |
| 接收 | `12c_cryptography/src/receiver.cpp` |
| 密码学基础 | `12c_cryptography/src/crypto.cpp` |
| WASM 导出 | `twelve_c_wasm/bindings.cpp` |
| 应用 `segment_code` 策略 | `../transfer/src/segment-policy.ts` |
| TS 封装 | `../transfer/src/wasm/loader.ts`、`session/upload-session.ts` |

### 命名约定（C++）

- `*_v2_*` / `kV2*`：整包模式（`segment_code = 0`）
- `*_v21_*` / `kV21*`：分段模式
- `*_for_segment_code`：按 `segment_code` 分发到 V2 或 V2.1

---

## WASM 构建

日常在 `client/` 根目录：

```powershell
cd client
.\build.ps1              # TypeScript + WASM（若 pkg 缺失）
.\build.ps1 -Production  # 另含 web 生产包，供 Registry 托管
```

仅重编密码学核心：

```powershell
cd client\core\twelve_c_wasm
.\build-wasm.ps1
```

产物路径（**必须含 `src`**）：

```text
client/transfer/src/wasm/pkg/twelve_c_cryptography.{js,wasm}
```

Web 开发时复制到：

```text
client/web/public/wasm/
```

emsdk 安装、OpenSSL 交叉编译、Perl/磁盘等细节见 [twelve_c_wasm/README.md](twelve_c_wasm/README.md)。

修改 `12c_cryptography` 或 `bindings.cpp` 后：**重跑 `build-wasm` + `client/build.ps1`（或至少 `copy:wasm`）+ 重启 Registry（若用 `:8080` 生产包）**。

---

## 原生 C++ 验证（可选）

需要本机 OpenSSL 开发包：

```powershell
cd client\core
.\build-native.ps1
```

输出：`build-test/native/`（CMake 编译 `twelve_c_cryptography` 静态库，不链接完整可执行测试套件）。

---

## WASM 对外 API（绑定层）

| 函数 | 说明 |
|------|------|
| `prepareUpload(plaintext, credential, fileName, segmentCode)` | 生成 `UploadMap`；`segmentCode` 由应用层传入 |
| `receiveFromUploadMap(credential, entries)` | 还原明文 |
| `parseSmbEncrypted(credential, smbEnc)` | 解析 Token[0] 内 SMB；含 `segmentCode` |
| `deriveUploadToken(searchCode, index)` | Token 名派生 |

TypeScript 类型：`client/transfer/src/wasm/pkg/twelve_c_cryptography.d.ts`（手维护，与 `bindings.cpp` 同步）。

---

## 应用层策略（可调）

定义于 `client/transfer/src/segment-policy.ts`：

| 常量 / 函数 | 默认值 | 含义 |
|-------------|--------|------|
| `V21_WHOLE_FILE_THRESHOLD_BYTES` | 16 MiB | ≤ 此大小用 V2（`segment_code = 0`） |
| `V21_DEFAULT_SEGMENT_CODE_LARGE_FILE` | `4` | 大文件用 128 MiB 分段 |
| `selectSegmentCodeForFileSize(n)` | 按上两项 | 上传前选择 `segment_code` |

调整策略时**只改 transfer 层**即可，无需改 C++，除非变更线速语义（则需同步协议文档与 `segment.cpp`）。

上传时可覆盖：`uploadFile(..., { segmentCode: 3 })`（见 `UploadSessionOptions`）。

---

## 与 Relay / Registry 部署相关的实现约束

以下不属于协议正文，但影响线上行为。

### Wire 块上限

协议 `MAX_WIRE_BLOCK_SIZE` = **16 MiB**，与 Relay 配置 `maxBodyBytes` 对齐（默认 `16777216`）。

```json
// server/relay/relay_server.config.json
"maxBodyBytes": 16777216
```

增大 `maxBodyBytes` 可减少大文件的 **Token 数量**（HTTP 次数），但单块 PUT 更重、失败重传粒度更粗。这与 V2.1 分段加密**无关**。

### Token 数量（经验值，`maxBodyBytes = 16 MiB`）

| 文件大小 | 约 Token 数 |
|----------|-------------|
| 44 MiB | ~3 |
| 500 MiB | ~32 |
| 1 GiB | ~64 |

由 `wire_layout.cpp` 根据总密文长度计算，与 `segment_code` 无直接关系。

### Registry + Client 同源（`:8080`）

生产环境 Client 静态资源由 Registry 托管 `client/web/dist/`。更新 UI 或 WASM 后：

1. `client/build.ps1 -Production`
2. 重启 Registry
3. 浏览器硬刷新；必要时清除 `localStorage` 里旧的 `stateless-relay.registryUrl`

开发仍用 Vite `:5173`，与 Registry `:8080` 是两套入口。

### 穿透 / HTTPS

公网隧道若提供自动 HTTPS，须用 `https://` 访问；`http://` 可能报 TLS 协议错误。Relay 的 `publicBaseUrl` 须与穿透地址一致。

---

## 接收侧

- 密码学还原：`receiver.cpp` → WASM `receiveFromUploadMap`
- 下载并发与 failover：`12c_receive_protocol/` + `client/transfer` 会话层

V2.1 接收根据 SMB 内 `segment_code` 解密，**不**猜测文件大小。

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [docs/12C-Transfer-Protocol.zh.md](../../docs/12C-Transfer-Protocol.zh.md) | 协议规范（中文） |
| [docs/12C-Transfer-Protocol.en.md](../../docs/12C-Transfer-Protocol.en.md) | Protocol spec (English) |
| [twelve_c_wasm/README.md](twelve_c_wasm/README.md) | WASM / emsdk / OpenSSL 构建 |
| [../README.md](../README.md) | Client 总览与脚本索引 |
| [../../HOW_TO_SETUP.md](../../HOW_TO_SETUP.md) | 全栈联调与穿透示例 |
