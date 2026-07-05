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

echo "Starting Registry on http://127.0.0.1:8080 ..."
exec "$PYTHON" -m registry_server "$@"
