# 12C STATELESS RELAY TRANSFER

This is a file transfer system based on 12C protocol that makes files stored stateless on relay servers and metadata undistinguishable. File extraction permission is conveyed using a 12-character out-of-band credential, which is responsible for data indexing and confidentiality.


# 添加 Electron 桌面应用

实现功能：
- 通过 Electron 将 Web 应用包装为独立桌面客户端
- 支持 macOS / Windows / Linux 跨平台打包

变更文件：
- 新增 client/electron/main.js (Electron 主进程入口)
- 修改 client/package.json (添加 electron 脚本和依赖)
- 修改 server/relay/relay_server.config.json (registry.url 改为本地地址)

关联：Web + PWA + Desktop 三端完整"
