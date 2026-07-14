# Server

12C 方案服务端。

| 目录 | 说明 |
|------|------|
| `registry/` | 注册服务器：路由解析、覆盖验证、中继心跳；**同时托管 Client Web**（`client/web/dist/`） |
| `relay/` | 中继服务器：磁盘块存储 + SQLite 映射、Registry 集成 |
| `console/` | **统一 Web 控制面板**（Relay 池、数据库表浏览、一键启停） |

Registry / Relay 采用分层布局：**api** → **services/domain** → **persistence**。详见各目录 `README.md`。

## 快速启动

### 一键启动全部（Windows）

```powershell
cd server
.\start-all.ps1
```

会在新窗口启动 Registry、Relay，并在当前窗口启动 Console（`http://127.0.0.1:8070`）。  
Client Web 由 Registry 一并分发：**http://127.0.0.1:8080**（需先执行 `client/build.ps1 -Production`）。

### 各服务独立启动

| 服务 | 命令 | 端口 | 说明 |
|------|------|------|------|
| Registry | `cd server\registry` → `.\start.ps1` | 8080 | 含 Client Web（`dist/` 已构建时） |
| Relay | `cd server\relay` → `.\start.ps1` | 9090 | |
| Console | `cd server\console` → `.\start.ps1` | 8070 | |

Linux / macOS 使用对应目录下的 `start.sh`。

各 `start` 脚本会自动创建虚拟环境、安装依赖，并在缺少配置时从 example 复制。

### Console 内一键启动

仅启动 Console 后，可在侧边栏 **服务** 区域点击「启动」按钮拉起 Registry / Relay（需正确配置 `registryDir` / `relayDir`）。

## 联调顺序（手动）

```powershell
# 1. Registry
cd server\registry
.\start.ps1

# 2. Relay（另开终端）
cd server\relay
.\start.ps1

# 3. Console（另开终端）
cd server\console
.\start.ps1
# 浏览器 http://127.0.0.1:8070
```

客户端 Registry 配置见 `client/transfer/relay.config.example.json`（`host`/`port` 指向 Registry）。
