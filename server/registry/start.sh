#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PYTHON=".venv/bin/python"
PIP=".venv/bin/pip"

if [[ ! -x "$PYTHON" ]]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

"$PIP" install -r requirements.txt -q

if [[ ! -f registry_server.config.json ]]; then
  cp registry_server.config.example.json registry_server.config.json
  echo "Created registry_server.config.json — adminApiKey / blockAuthMasterKey auto-generate in registry_server.secrets.json."
fi

echo "Starting Registry (+ Client Web when dist/ is built) on http://127.0.0.1:8080 ..."
if [[ ! -f ../../client/web/dist/index.html ]]; then
  echo ""
  echo "提示: client/web/dist/ 尚未构建，Registry 仅提供 API。构建后重启即可挂载 Client:"
  echo "  cd client"
  echo "  ./build.ps1 -Production"
  echo ""
fi
exec "$PYTHON" -m registry_server "$@"
