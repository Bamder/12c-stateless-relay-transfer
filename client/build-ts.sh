#!/usr/bin/env bash
# 编译 Client TypeScript 工作区（transfer → app）
set -euo pipefail

CLIENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${CLIENT_ROOT}"

echo ""
echo "==> 编译 TypeScript 工作区（transfer → app）"
npm run build -w @stateless-relay/transfer
npm run build -w @stateless-relay/app

echo ""
echo "TypeScript 构建完成。"
