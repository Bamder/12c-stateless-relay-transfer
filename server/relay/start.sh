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

if [[ ! -f relay_server.config.json ]]; then
  cp relay_server.config.example.json relay_server.config.json
  echo "Created relay_server.config.json — adminApiKey auto-generates in relay_server.secrets.json."
fi

echo "Starting Relay on http://127.0.0.1:9090 ..."
exec "$PYTHON" -m relay_server "$@"
