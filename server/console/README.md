# 12C Control Console

Registry 与 Relay 的统一 Web 控制面板（BFF 代理 + 静态前端）。

## 功能

- 左侧栏切换 **Registry** / **Relay** 管理视图
- **一键启动** Registry、Relay（侧边栏服务控制区）
- **一键关闭** Registry、Relay（运行中显示「关闭」按钮）
- Registry：Relay 缩略图卡片（在线 / 过期 / 未上报 / 已禁用）、右键管理 / 移除、添加入池
- Registry / Relay：SQLite 表数据浏览（敏感字段脱敏）

## 目录结构

```
console_server/
  __main__.py       # CLI
  config.py
  api/
    app.py          # 控制台 API + 静态页
    proxy.py        # 转发至 Registry / Relay Admin API
  runtime/
    process_manager.py  # 子进程启动与健康探测
static/
  index.html
  styles.css
  app.js
start.ps1 / start.sh    # 本地启动脚本
```

## 运行

### 方式一：启动脚本（推荐）

```powershell
cd server\console
.\start.ps1
```

首次运行会自动创建 `.venv`、安装依赖，并从 example 复制配置文件。

### 方式二：一键启动全部服务

在 `server/` 目录：

```powershell
.\start-all.ps1
```

会在新窗口启动 Registry、Relay，并在当前窗口启动 Console。

### 方式三：手动

需先启动 Registry、Relay，或在 Console 侧边栏点击「启动」。

```powershell
cd server\console
pip install -r requirements.txt
Copy-Item console_server.config.example.json console_server.config.json
# 编辑 registryAdminApiKey / relayAdminApiKey
python -m console_server
```

浏览器打开 `http://127.0.0.1:8070`。

## 配置

`console_server.config.json` 除 Admin API Key 外，还可指定本地服务路径（供一键启动使用）：

| 字段 | 说明 |
|------|------|
| `registryDir` | Registry 项目目录，默认 `../registry` |
| `relayDir` | Relay 项目目录，默认 `../relay` |
| `registryConfig` | Registry 配置文件名/路径，默认 `registry_server.config.json` |
| `relayConfig` | Relay 配置文件名/路径，默认 `relay_server.config.json` |

## 服务控制 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/services/status` | Registry / Relay 运行状态 |
| POST | `/api/services/registry/start` | 启动 Registry |
| POST | `/api/services/registry/stop` | 关闭 Registry |
| POST | `/api/services/relay/start` | 启动 Relay |
| POST | `/api/services/relay/stop` | 关闭 Relay |

## 依赖 Admin API

| 服务 | 端点 |
|------|------|
| Registry | `GET /api/admin/relays/overview`、`GET /api/admin/db`、`POST/PATCH /api/admin/allowlist` |
| Relay | `GET /api/admin/overview`、`GET /api/admin/db` |

Registry / Relay 均需配置 `adminApiKey`（或 `REGISTRY_ADMIN_API_KEY` / `RELAY_ADMIN_API_KEY`）。
