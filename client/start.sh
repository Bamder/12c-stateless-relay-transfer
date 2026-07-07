#!/usr/bin/env bash
# 构建 Client（如需）并启动 Web 开发服务器
set -euo pipefail

CLIENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_PKG="${CLIENT_ROOT}/transfer/src/wasm/pkg/twelve_c_cryptography.wasm"
APP_DIST="${CLIENT_ROOT}/app/dist/index.d.ts"

if [[ "${1:-}" != "--skip-build" ]]; then
  if [[ ! -f "${WASM_PKG}" || ! -d "${CLIENT_ROOT}/node_modules" ]]; then
    echo "首次运行或缺少 WASM，正在执行 build.sh ..."
    "${CLIENT_ROOT}/build.sh"
  else
    if [[ ! -f "${APP_DIST}" ]]; then
      echo "缺少 TypeScript dist，正在执行 build-ts.sh ..."
      "${CLIENT_ROOT}/build-ts.sh"
    fi
    (cd "${CLIENT_ROOT}/web" && npm run copy:wasm)
  fi
fi

exec "${CLIENT_ROOT}/web/start.sh"
