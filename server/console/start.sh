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

if [[ ! -f console_server.config.json ]]; then
  cp console_server.config.example.json console_server.config.json
  echo "Created console_server.config.json — admin keys auto-sync from service *.secrets.json on startup."
fi

echo "Starting Console on http://127.0.0.1:8070 ..."
exec "$PYTHON" -m console_server "$@"
