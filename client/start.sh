#!/usr/bin/env bash
# 构建 Client（如需）并启动 Web 开发服务器
set -euo pipefail

CLIENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_PKG="${CLIENT_ROOT}/transfer/src/wasm/pkg/twelve_c_cryptography.wasm"

if [[ "${1:-}" != "--skip-build" ]]; then
  if [[ ! -f "${WASM_PKG}" || ! -d "${CLIENT_ROOT}/node_modules" ]]; then
    echo "首次运行或缺少 WASM，正在执行 build.sh ..."
    "${CLIENT_ROOT}/build.sh"
  else
    (cd "${CLIENT_ROOT}/web" && npm run copy:wasm)
  fi
fi

exec "${CLIENT_ROOT}/web/start.sh"
