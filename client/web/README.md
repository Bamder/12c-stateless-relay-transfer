# 12C Client Web UI

浏览器端文件发送 / 接收界面，基于 `@stateless-relay/app` 与 WASM 加密核心。

## 功能

- **发送**：选择文件 → 加密上传 → 生成 12 位带外凭证
- **接收**：输入凭证 → 从 Relay 下载并解密保存
- **设置**：配置 Registry URL（默认读 `/relay.config.json`，可存本地）

## 启动

**推荐**在 `client/` 根目录使用一键脚本（见 [`client/README.md`](../README.md)）：

```powershell
cd client
.\start.ps1
```

或仅启动 Web（须已构建 WASM）：

```powershell
cd client\web
.\start.ps1
```

浏览器默认打开 `http://127.0.0.1:5173`。

## 配置

编辑 `public/relay.config.json`（**仅 Vite 开发模式**使用）：

```json
{
  "registry": {
    "url": "http://127.0.0.1:8080"
  }
}
```

生产环境由 **Registry 托管**时，打开 `http://127.0.0.1:8080` 即可；Registry 会动态下发同源配置。

需先启动 Registry 与至少一个已审批的 Relay。

## 构建

```powershell
cd client
.\build.ps1 -Production
cd web
npm run preview
```

## 说明

- WASM 文件由 `npm run copy:wasm` 从 `transfer/src/wasm/pkg/` 复制到 `public/wasm/`（含 `.js` 与 `.wasm`，勿让 Vite 打包 Emscripten 胶水代码）
- 若尚未构建 WASM，请在 `client/transfer` 或 `client/core/twelve_c_wasm` 按 README 执行 `build-wasm`
- 浏览器直接向 Registry / Relay 发请求，请确保 CORS 或同源策略允许（本地开发通常使用 Registry 默认配置）
