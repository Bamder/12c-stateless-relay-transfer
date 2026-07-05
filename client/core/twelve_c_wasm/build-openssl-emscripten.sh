#!/usr/bin/env bash
# 为 Emscripten 交叉编译 OpenSSL 静态库（libcrypto），供 twelve_c WASM 链接。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENSSL_VERSION="${OPENSSL_VERSION:-1.1.1w}"
THIRD_PARTY_DIR="${PROJECT_DIR}/third_party"
INSTALL_ROOT="${THIRD_PARTY_DIR}/openssl-emscripten"
CRYPTO_LIB="${INSTALL_ROOT}/lib/libcrypto.a"
SOURCE_DIR="${THIRD_PARTY_DIR}/openssl-${OPENSSL_VERSION}"
TARBALL="${THIRD_PARTY_DIR}/openssl-${OPENSSL_VERSION}.tar.gz"
DOWNLOAD_URL="https://www.openssl.org/source/openssl-${OPENSSL_VERSION}.tar.gz"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

ensure_emscripten_active() {
  if command -v emconfigure >/dev/null 2>&1; then
    return 0
  fi

  local root
  for root in "${EMSDK:-}" "${HOME}/emsdk" "/opt/emsdk"; do
    [[ -z "${root}" ]] && continue
    if [[ -f "${root}/emsdk_env.sh" ]]; then
      echo "Activating emsdk from ${root} ..." >&2
      # shellcheck disable=SC1091
      source "${root}/emsdk_env.sh"
      command -v emconfigure >/dev/null 2>&1 && return 0
    fi
  done

  echo "Emscripten not active. Run setup-emsdk.sh first." >&2
  exit 1
}

if [[ -f "${CRYPTO_LIB}" ]]; then
  echo "OpenSSL for Emscripten already built: ${CRYPTO_LIB}"
  exit 0
fi

require_command perl
ensure_emscripten_active
require_command emconfigure
require_command emmake

mkdir -p "${THIRD_PARTY_DIR}"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  if [[ ! -f "${TARBALL}" ]]; then
    echo "Downloading OpenSSL ${OPENSSL_VERSION} ..."
    curl -L "${DOWNLOAD_URL}" -o "${TARBALL}"
  fi
  echo "Extracting OpenSSL source ..."
  tar -xf "${TARBALL}" -C "${THIRD_PARTY_DIR}"
fi

[[ -f "${SOURCE_DIR}/Configure" ]] || { echo "OpenSSL source incomplete at ${SOURCE_DIR}" >&2; exit 1; }

export LC_ALL=C
export LANG=C
export LANGUAGE=C
export PERL_BADLANG=0

IS_OPENSSL_3=0
[[ "${OPENSSL_VERSION}" == 3.* ]] && IS_OPENSSL_3=1
INSTALL_TARGET="install_dev"
[[ "${IS_OPENSSL_3}" -eq 1 ]] && INSTALL_TARGET="install_sw"

cd "${SOURCE_DIR}"
if [[ -f Makefile ]]; then
  emmake make clean >/dev/null || true
fi

echo "Configuring OpenSSL ${OPENSSL_VERSION} for Emscripten (no-asm static libcrypto) ..."
if [[ "${IS_OPENSSL_3}" -eq 1 ]]; then
  emconfigure perl ./Configure \
    linux-x32 \
    no-shared \
    no-asm \
    no-tests \
    no-ui-console \
    no-docs \
    no-ssl3 \
    no-dtls \
    no-engine \
    --prefix="${INSTALL_ROOT}" \
    --openssldir="${INSTALL_ROOT}"
else
  emconfigure perl ./Configure \
    linux-x32 \
    no-shared \
    no-asm \
    no-tests \
    --prefix="${INSTALL_ROOT}" \
    --openssldir="${INSTALL_ROOT}"
fi

sed -i 's|^CROSS_COMPILE.*$|CROSS_COMPILE=|g' Makefile
sed -i 's|^CC=.*|CC=emcc|' Makefile
sed -i 's|^CXX=.*|CXX=em++|' Makefile
sed -i 's|^AR=.*|AR=emar|' Makefile
sed -i 's|^RANLIB=.*|RANLIB=emranlib|' Makefile

echo "Building libcrypto.a (may take several minutes) ..."
emmake make -j"$(nproc 2>/dev/null || echo 2)" build_generated libcrypto.a
emmake make "${INSTALL_TARGET}"

[[ -f "${CRYPTO_LIB}" ]] || { echo "Expected output missing: ${CRYPTO_LIB}" >&2; exit 1; }
echo "OpenSSL for Emscripten ready at ${INSTALL_ROOT}"
