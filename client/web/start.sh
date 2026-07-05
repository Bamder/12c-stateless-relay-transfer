#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d ../node_modules ]]; then
  (cd .. && npm install)
fi

exec npm run dev
