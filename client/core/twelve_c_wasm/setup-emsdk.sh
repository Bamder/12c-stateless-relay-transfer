#!/usr/bin/env bash
# 一次性安装并激活 Emscripten SDK（Linux / macOS / WSL）。
#
# Usage:
#   ./setup-emsdk.sh
#   ./setup-emsdk.sh /opt/emsdk
#   ./setup-emsdk.sh /opt/emsdk --set-env
set -euo pipefail

SET_ENV=false
INSTALL_ROOT="${EMSDK:-${HOME}/emsdk}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --set-env)
      SET_ENV=true
      shift
      ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [INSTALL_ROOT] [--set-env]

  INSTALL_ROOT  emsdk 安装目录（默认: \$EMSDK 或 \$HOME/emsdk）
  --set-env     写入当前 shell 的 EMSDK，并追加到 ~/.bashrc / ~/.zshrc（若存在）
EOF
      exit 0
      ;;
    *)
      INSTALL_ROOT="$1"
      shift
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

set_emsdk_environment() {
  local root="$1"
  export EMSDK="${root}"
  local line="export EMSDK=\"${root}\""
  local profile updated=false

  for profile in "${HOME}/.bashrc" "${HOME}/.zshrc"; do
    if [[ -f "${profile}" ]]; then
      if grep -qF "${line}" "${profile}" 2>/dev/null; then
        echo "EMSDK already in ${profile}"
      else
        {
          echo ""
          echo "# emsdk (added by setup-emsdk.sh)"
          echo "${line}"
        } >> "${profile}"
        echo "Appended EMSDK to ${profile}"
      fi
      updated=true
    fi
  done

  if [[ "${updated}" == false ]]; then
    echo "No ~/.bashrc or ~/.zshrc found; add manually: ${line}" >&2
  else
    echo "EMSDK=${root} (current shell + shell profile; open a new terminal to inherit)."
  fi
}

require_command git
require_command python3

if [[ ! -d "${INSTALL_ROOT}" ]]; then
  echo "Cloning emsdk to ${INSTALL_ROOT} ..."
  mkdir -p "$(dirname "${INSTALL_ROOT}")"
  git clone https://github.com/emscripten-core/emsdk.git "${INSTALL_ROOT}"
fi

cd "${INSTALL_ROOT}"

echo "Installing Emscripten (latest) — may take several minutes ..."
./emsdk install latest
./emsdk activate latest

if [[ "${SET_ENV}" == true ]]; then
  set_emsdk_environment "${INSTALL_ROOT}"
fi

cat <<EOF

Emscripten installed at: ${INSTALL_ROOT}

Next steps:
  1. In THIS shell:  source "${INSTALL_ROOT}/emsdk_env.sh"
  2. Build WASM:     $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-wasm.sh
EOF

if [[ "${SET_ENV}" == false ]]; then
  cat <<EOF

Optional: persist EMSDK for future sessions:
  ./setup-emsdk.sh "${INSTALL_ROOT}" --set-env
EOF
fi
