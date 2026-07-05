#!/usr/bin/env bash
# 原生 C++ 编译 twelve_c → 仓库根 build-test/native/
set -euo pipefail

CONFIG="${1:-Release}"
CORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEME_DIR="${CORE_ROOT}/12c_file_transfer_scheme"
REPO_ROOT="$(cd "${CORE_ROOT}/../.." && pwd)"
BUILD_DIR="${REPO_ROOT}/build-test/native"

if [[ ! -d "${SCHEME_DIR}" ]]; then
  echo "Scheme sources not found: ${SCHEME_DIR}" >&2
  exit 1
fi

echo "==> CMake configure (${CONFIG})"
mkdir -p "${BUILD_DIR}"
cmake -S "${SCHEME_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE="${CONFIG}"

echo "==> CMake build"
cmake --build "${BUILD_DIR}" --config "${CONFIG}"

echo ""
echo "Native build output: ${BUILD_DIR}"
