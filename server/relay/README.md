# 12C Relay Server

无状态 blob 中继；Registry 通信使用 **registryApiKey**（对称密钥）与 **blockAuthKey**（覆盖 HMAC 验签），RSA 公钥仅用于接收加密轮换密钥。

## 目录结构

```
relay_server/
  __main__.py          # CLI 入口（uvicorn）
  config.py            # 配置加载
  api/                 # HTTP 层
    app.py             # FastAPI 工厂、PUT/GET 路由
    deps.py            # token 规范化等
  domain/              # 领域逻辑
    blocks.py          # 块读写、覆盖验签、sweep
  persistence/         # 存储
    repository.py      # SQLite 块索引
    disk_store.py      # 磁盘 blob
  registry/            # 与 Registry 通信
    client.py          # HTTP 客户端
    api_key_manager.py / api_key_store.py
    block_auth_key_manager.py / block_auth_key_store.py
  crypto/
    block_auth.py      # HMAC 验签
  runtime/
    background.py      # heartbeat 与 block sweep 后台任务
```

| 层 | 职责 |
|----|------|
| **api** | HTTP 路由与异常映射 |
| **domain** | PUT/GET 业务、容量与过期策略 |
| **persistence** | DB + 磁盘；不含 Registry 协议 |
| **registry** | 密钥轮换、bootstrap、heartbeat/register |
| **runtime** | 长驻 asyncio 任务 |

## 密钥流程

1. **启动**：生成/加载 `data/secrets/relay_rsa.pem`；若无 `registry_api_key.json` / `block_auth_key.json` 则 heartbeat bootstrap
2. **日常**：`register` / `verify-overwrite` / `heartbeat` 自动携带 `registryApiKeyId` + `registryApiKey`
3. **覆盖**：`verify-overwrite` 返回 HMAC；Relay 用本地 `blockAuthKey` 验签 + 检查 `expiryAt`
4. **轮换**：heartbeat 耗尽次数后，Registry 返回捆绑的 `nextRegistryApiKey` 与 `nextBlockAuthKey`（RSA-OAEP），Relay 解密并原子写入

## 配置

| 字段 | 说明 |
|------|------|
| `registryApiKeyStorePath` | 当前对称 registryApiKey |
| `blockAuthKeyStorePath` | 当前 blockAuthKey（默认 `data/secrets/block_auth_key.json`） |
| `registryApiKeyInitialUses` | 与 Registry 对齐的初始次数 |
| `registry.url` | Registry 根 URL |
| `registry.httpProxy` | （可选）访问 Registry 的显式 HTTP 代理；未设置则直连，且忽略系统 `HTTP_PROXY` |
| `registry.autoRegisterOnStartup` | 启动后是否自动向 Registry 提交注册申请，默认 `false`；关闭时需通过 Console 手动申请 |
| `blockMaxAgeSeconds` | 本地块最大保留秒数（默认 86400 = 24 小时）；到期删盘 + SQLite 行，与 Registry `tokenTtlSeconds` 解耦 |
| `blockSweepIntervalSeconds` | 过期清理扫描间隔秒数（默认 3600）；启动时也会执行一次 sweep |
| `adminApiKey` | 运维 / 控制面板 API 鉴权；也可用 `RELAY_ADMIN_API_KEY` |

### Admin API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/overview` | 运行概览 |
| `GET` | `/api/admin/db` | `blocks` 表浏览 |

鉴权头：`Authorization: Bearer <adminApiKey>` 或 `X-Relay-Admin-Key`。

## 块过期清理

- 依据 SQLite `blocks.updated_at` 删除过期登记块（覆盖写入会刷新 `updated_at`）。
- 扫描 `dataDir` 下无 DB 行、且文件 mtime 超过 `blockMaxAgeSeconds` 的孤儿 `.bin` 并删除。
- 新 token 经 Registry `reserve-tokens` 登记后，同 key 覆盖 PUT 仍走 blockAuth 路径。

## 运行

```powershell
cd server\relay
pip install -r requirements.txt
Copy-Item relay_server.config.example.json relay_server.config.json
python -m relay_server
```

`GET /health` 含 `registryApiKeyReady` 与 `blockAuthKeyReady` 字段。

升级 blockAuth 后请删除 `registry_api_key.json` 与 `block_auth_key.json` 后重启以重新 bootstrap。
