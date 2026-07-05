#!/usr/bin/env bash
# 构建 twelve_c WASM 并复制到 client/transfer/src/wasm/pkg/
#
# 注意：正确路径含 src/，不是 client/transfer/wasm/pkg
# loader.ts 从 src/wasm/pkg/ 动态 import 产物。
#
# 使用顺序（Unix）：
#   1. ./setup-emsdk.sh [install_root]
#   2. ./build-wasm.sh
#
# Usage:
#   ./build-wasm.sh
#   EMSDK=/opt/emsdk ./build-wasm.sh
#   ./build-wasm.sh /opt/emsdk
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
TRANSFER_ROOT="$(cd "${PROJECT_DIR}/../../transfer" && pwd)"
OUT_DIR="${TRANSFER_ROOT}/src/wasm/pkg"
EMSDK_ROOT="${1:-${EMSDK:-}}"

candidate_emsdk_roots() {
  local roots=()
  [[ -n "${EMSDK_ROOT}" ]] && roots+=("${EMSDK_ROOT}")
  [[ -n "${EMSDK:-}" ]] && roots+=("${EMSDK}")
  roots+=("${HOME}/emsdk" "/opt/emsdk" "/usr/local/emsdk")

  local root
  for root in "${roots[@]}"; do
    [[ -n "${root}" ]] && printf '%s\n' "${root}"
  done | awk '!seen[$0]++'
}

candidate_emscripten_paths() {
  [[ -n "${EMSCRIPTEN:-}" ]] && printf '%s\n' "${EMSCRIPTEN}"

  local root
  while IFS= read -r root; do
    [[ -n "${root}" ]] && printf '%s\n' "${root}/upstream/emscripten"
  done < <(candidate_emsdk_roots)
}

initialize_emscripten() {
  local path root

  while IFS= read -r path; do
    [[ -z "${path}" ]] && continue
    if [[ -x "${path}/emcmake" || -f "${path}/emcmake.exe" ]]; then
      printf '%s' "${path}"
      return 0
    fi
  done < <(candidate_emscripten_paths)

  if command -v emcmake >/dev/null 2>&1; then
    dirname "$(command -v emcmake)"
    return 0
  fi

  while IFS= read -r root; do
    [[ -z "${root}" ]] && continue
    if [[ -f "${root}/emsdk_env.sh" ]]; then
      echo "Activating emsdk from ${root} ..." >&2
      # shellcheck disable=SC1091
      source "${root}/emsdk_env.sh"
      while IFS= read -r path; do
        [[ -z "${path}" ]] && continue
        if [[ -x "${path}/emcmake" || -f "${path}/emcmake.exe" ]]; then
          printf '%s' "${path}"
          return 0
        fi
      done < <(candidate_emscripten_paths)
      if command -v emcmake >/dev/null 2>&1; then
        dirname "$(command -v emcmake)"
        return 0
      fi
    fi
  done < <(candidate_emsdk_roots)

  return 1
}

if ! EMSCRIPTEN_ROOT="$(initialize_emscripten)"; then
  cat >&2 <<EOF
Emscripten not found.

First-time setup (requires git + python3):
  cd ${PROJECT_DIR}
  ./setup-emsdk.sh

Then activate and build in the same shell:
  source "\${HOME}/emsdk/emsdk_env.sh"
  ./build-wasm.sh

Or pass your emsdk path:
  ./build-wasm.sh /path/to/emsdk
EOF
  exit 1
fi

echo "Using Emscripten: ${EMSCRIPTEN_ROOT}"

CRYPTO_LIB="${PROJECT_DIR}/third_party/openssl-emscripten/lib/libcrypto.a"
if [[ ! -f "${CRYPTO_LIB}" ]]; then
  echo "OpenSSL for Emscripten not found; building (one-time, may take several minutes) ..."
  bash "${PROJECT_DIR}/build-openssl-emscripten.sh"
fi

mkdir -p "${BUILD_DIR}" "${OUT_DIR}"

emcmake cmake -S "${PROJECT_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" --config Release

JS_FILE="${BUILD_DIR}/twelve_c_cryptography.js"
WASM_FILE="${BUILD_DIR}/twelve_c_cryptography.wasm"

[[ -f "${JS_FILE}" ]] || { echo "missing output: ${JS_FILE}" >&2; exit 1; }
[[ -f "${WASM_FILE}" ]] || { echo "missing output: ${WASM_FILE}" >&2; exit 1; }

cp -f "${JS_FILE}" "${OUT_DIR}/"
cp -f "${WASM_FILE}" "${OUT_DIR}/"

echo "WASM artifacts copied to ${OUT_DIR}"
