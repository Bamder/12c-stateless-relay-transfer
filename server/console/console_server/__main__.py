from __future__ import annotations

import argparse

import uvicorn

from .api.app import create_app
from .config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="12C control console")
    parser.add_argument("--config", help="path to console_server.config.json")
    args = parser.parse_args()

    config = load_config(args.config)
    uvicorn.run(
        create_app(config),
        host=config.host,
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
