#!/usr/bin/env bash
# 一键构建 Client：npm install → WASM（如需）→ copy:wasm → 可选生产打包
#
# 用法：
#   ./build.sh
#   ./build.sh --setup-emsdk /opt/emsdk
#   ./build.sh --force-wasm
#   ./build.sh --production
#   ./start.sh
set -euo pipefail

CLIENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_PKG="${CLIENT_ROOT}/transfer/src/wasm/pkg/twelve_c_cryptography.wasm"
WASM_SCRIPT_DIR="${CLIENT_ROOT}/core/twelve_c_wasm"
WEB_DIR="${CLIENT_ROOT}/web"

SETUP_EMSDK=0
SKIP_WASM=0
FORCE_WASM=0
PRODUCTION=0
EMSDK_ROOT="${EMSDK:-}"

usage() {
  cat <<'EOF'
Usage: ./build.sh [OPTIONS]

  --setup-emsdk [ROOT]   先安装 emsdk（首次）
  --emsdk-root ROOT      emsdk 根目录（传给 build-wasm）
  --skip-wasm            跳过 WASM 编译
  --force-wasm           强制重编 WASM
  --production           额外 vite build → web/dist/
  -h, --help             显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup-emsdk)
      SETUP_EMSDK=1
      if [[ "${2:-}" != "" && "${2:-}" != --* ]]; then
        EMSDK_ROOT="$2"
        shift
      fi
      ;;
    --emsdk-root)
      EMSDK_ROOT="${2:?missing value for --emsdk-root}"
      shift
      ;;
    --skip-wasm) SKIP_WASM=1 ;;
    --force-wasm) FORCE_WASM=1 ;;
    --production) PRODUCTION=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

step() {
  echo ""
  echo "==> $1"
}

cd "${CLIENT_ROOT}"

step "安装 npm 依赖（workspaces）"
if [[ ! -d node_modules ]]; then
  npm install
else
  echo "node_modules 已存在，跳过 npm install"
fi

if [[ "${SETUP_EMSDK}" -eq 1 ]]; then
  step "安装 Emscripten SDK（一次性）"
  if [[ -n "${EMSDK_ROOT}" ]]; then
    "${WASM_SCRIPT_DIR}/setup-emsdk.sh" "${EMSDK_ROOT}" --set-env
  else
    "${WASM_SCRIPT_DIR}/setup-emsdk.sh" --set-env
  fi
fi

NEED_WASM=0
if [[ "${SKIP_WASM}" -eq 0 ]]; then
  if [[ "${FORCE_WASM}" -eq 1 || ! -f "${WASM_PKG}" ]]; then
    NEED_WASM=1
  fi
fi

if [[ "${NEED_WASM}" -eq 1 ]]; then
  step "编译 WASM → transfer/src/wasm/pkg/"
  if [[ -n "${EMSDK_ROOT}" ]]; then
    EMSDK="${EMSDK_ROOT}" "${WASM_SCRIPT_DIR}/build-wasm.sh" "${EMSDK_ROOT}"
  else
    "${WASM_SCRIPT_DIR}/build-wasm.sh"
  fi
elif [[ "${SKIP_WASM}" -eq 1 ]]; then
  echo "已跳过 WASM 编译（--skip-wasm）"
else
  echo "WASM 产物已存在：${WASM_PKG}（使用 --force-wasm 可强制重编）"
fi

step "复制 WASM → web/public/wasm/"
cd "${WEB_DIR}"
npm run copy:wasm

if [[ "${PRODUCTION}" -eq 1 ]]; then
  step "Vite 生产构建 → web/dist/"
  npm run build
  echo ""
  echo "完成。静态产物：${WEB_DIR}/dist/"
else
  echo ""
  echo "Client 构建完成。启动开发服务器："
  echo "  cd client && ./start.sh"
fi
