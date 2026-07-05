#!/usr/bin/env bash
# 后台启动 Registry、Relay，前台启动 Console
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Launching Registry..."
( cd "$ROOT/registry" && ./start.sh ) &
REGISTRY_PID=$!
sleep 2

echo "Launching Relay..."
( cd "$ROOT/relay" && ./start.sh ) &
RELAY_PID=$!
sleep 1

echo "Launching Console (Ctrl+C 仅停止 Console；Registry/Relay 需手动结束 PID $REGISTRY_PID / $RELAY_PID)..."
cd "$ROOT/console"
exec ./start.sh
