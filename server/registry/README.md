# 12C Registry Server

token → relay 路由、中继心跳、Allowlist、**registryApiKey**（对称密钥）与 **blockAuthKey**（HKDF 派生 HMAC）轮换。

## 目录结构

```
registry_server/
  __main__.py          # CLI 入口（uvicorn）
  config.py            # 配置加载
  api/                 # HTTP 层
    app.py             # FastAPI 工厂与 lifespan
    schemas.py         # 请求/响应模型
    deps.py            # 鉴权、序列化辅助
    routes/            # /api/relay、/api/admin 路由
  services/            # 业务逻辑
    registry.py        # RegistryService
  persistence/         # 存储
    repository.py      # SQLite 仓储
  crypto/              # 密码学
    block_auth.py      # blockAuth HMAC / HKDF
    keys.py            # registryApiKey 哈希与 RSA 加密
  scheduling/          # 调度
    placement.py       # 条带 / replica placement
```

| 层 | 职责 |
|----|------|
| **api** | 路由、Pydantic、HTTP 鉴权；不含业务规则 |
| **services** | token 占用、heartbeat、allowlist、覆盖授权 |
| **persistence** | 表结构与 SQL；不含 HTTP |
| **crypto / scheduling** | 可复用原语与算法 |

## 密钥模型

| 名称 | 类型 | 用途 |
|------|------|------|
| **registryApiKey** | 对称密钥 | 中继 API 鉴权：`heartbeat`（扣次数）、`register`、`verify-overwrite` |
| **blockAuthMasterKey** | 32+ 字节主密钥 | 仅 Registry 持有；按 `relayId` + `keyId` HKDF 派生 **blockAuthKey** |
| **blockAuthKey** | 派生对称密钥 | Registry 签发覆盖授权 HMAC；Relay 本地存储派生 bytes（不存 master） |
| **relayPublicKeyPem** | RSA 公钥 | Registry 加密下发下一版 **registryApiKey** / **blockAuthKey** |

## API 字段（中继 → Registry）

```json
{
  "relayId": "relay-1",
  "relayBaseUrl": "http://127.0.0.1:9090",
  "registryApiKeyId": "...",
  "registryApiKey": "..."
}
```

### `POST /api/relay/heartbeat`

- 首次：仅 `relayPublicKeyPem` → 返回 `bootstrapRegistryApiKey` + `bootstrapRegistryApiKeyId`，以及 `bootstrapBlockAuthKey` + `bootstrapBlockAuthKeyId`
- 后续：带 `registryApiKeyId` + `registryApiKey`；用尽时返回 `nextRegistryApiKey` 与捆绑的 `nextBlockAuthKey`（RSA-OAEP 加密）

### `POST /api/relay/resolve`（下载）

请求体 `{ "tokens": ["..."] }`，返回：

```json
{
  "routes": [{
    "token": "...",
    "targets": [
      { "role": "replica", "relayId": "relay-c", "relayBaseUrl": "http://..." },
      { "role": "primary", "relayId": "relay-a", "relayBaseUrl": "http://..." }
    ]
  }]
}
```

`targets` 按单 token **读导流**排序：健康且未过期的持有者中，`storage_rate` 升序（最闲优先）；同负载时 primary 优先。客户端应把首个 target 作为首选 GET，其余作为 failover。仍要求至少有一个 live primary，否则该 token 不可解析。

### 上传路由

1. `POST /api/relay/reserve-tokens` — `{ blocks: [{ token, blockHash }] }`；全部未占用则锁定并写入 placement
2. Relay 重复 PUT 时 `verify-overwrite`（须与已登记 hash 一致；Registry 返回 HMAC 授权）
3. Relay 本地验 MAC + `expiryAt` 后允许覆盖
4. Relay `register` 仅确认 hash，不得改写客户端登记

占用时 `409` + `occupiedTokens`。

#### `POST /api/relay/abandon-replica-placements`

客户端 replica 补传放弃时调用，删除对应 **replica** placement（**不**删 primary）：

```json
{ "failures": [{ "token": "...", "relayId": "..." }] }
```

响应 `{ "removed": [{ "token", "relayId" }, ...] }`。

### `POST /api/relay/verify-overwrite`

必须携带有效 **registryApiKey**（校验但不扣次数）。校验通过后返回：

```json
{
  "blockHash": "...",
  "blockAuthKeyId": "...",
  "blockAuthMac": "...",
  "blockAuthAlgorithm": "HMAC-SHA256-v1",
  "expiryAt": "..."
}
```

Canonical 串：`12C-BLOCK-AUTH-v1|keyId|token|relayId|relayBaseUrl|blockHash|expiryAt`

## 配置

| 字段 | 说明 |
|------|------|
| `registryApiKeyInitialUses` | 每个对称 registryApiKey 可用次数（默认 100） |
| `blockAuthMasterKey` | urlsafe base64，≥32 字节；也可用环境变量 `REGISTRY_BLOCK_AUTH_MASTER_KEY` |
| `adminApiKey` | 运维 API 鉴权密钥；也可用环境变量 `REGISTRY_ADMIN_API_KEY` |
| `heartbeatUrlPolicy` | `sync_if_unset`（默认）或 `strict`；见下 |

### heartbeat URL 一致性

`heartbeat` / `register` / `verify-overwrite` 上报的 `relayBaseUrl` 与 allowlist 对齐：

| 策略 | allowlist 无 URL | allowlist 有 URL |
|------|------------------|------------------|
| `sync_if_unset`（默认） | 首次 heartbeat **写入** allowlist | 必须 **完全一致**（409） |
| `strict` | 拒绝（409，须运维先配置 URL） | 必须 **完全一致**（409） |

写入 `relay_states` 的 URL 为校验/同步后的 canonical 值（去尾斜杠）。

生成 master key：`python -c "import secrets; print(secrets.token_urlsafe(32))"`

### Allowlist 运维 API

需配置 `adminApiKey`（或 `REGISTRY_ADMIN_API_KEY`）。请求头任选其一：

- `Authorization: Bearer <adminApiKey>`
- `X-Registry-Admin-Key: <adminApiKey>`

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/allowlist` | 列出全部条目（含已禁用） |
| `POST` | `/api/admin/allowlist` | 入池或重新启用：`{ relayId, relayBaseUrl? }` |
| `PATCH` | `/api/admin/allowlist/{relayId}` | 更新 URL 或 `enabled` |

`POST` / 配置文件 seed 在冲突时会更新 `relayBaseUrl` 并将 `enabled` 置为 `true`。禁用后 relay 无法 heartbeat（403）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/relays/overview` | Relay 卡片数据（Allowlist + 心跳状态） |
| `GET` | `/api/admin/db` | 各 SQLite 表浏览（敏感字段脱敏） |

控制面板见 `server/console/`。

## Client Web 托管

Registry 同时分发 `client/web/dist/` 静态产物，使 Client 与 Registry **同源绑定**：

| 路径 | 说明 |
|------|------|
| `/` | Client Web（`index.html` + SPA 回退） |
| `/relay.config.json` | 动态生成，Registry URL 为当前访问来源（支持 `X-Forwarded-*`） |
| `/api/relay/*` | Registry API（优先于静态路由） |
| `/health` | 健康检查；含 `clientDistReady` 字段 |

配置项 `clientStaticDir`（默认 `../../client/web/dist`）；设为 `false` 可禁用托管。
如果反向代理把 Registry 挂载到子路径，请同时转发
`X-Forwarded-Prefix`（例如 `/services/registry`），动态配置和二维码会保留该前缀。

构建 Client 后重启 Registry：

```powershell
cd client
.\build.ps1 -Production
```

## 运行

```powershell
cd server\registry
pip install -r requirements.txt
Copy-Item registry_server.config.example.json registry_server.config.json
python -m registry_server
```
