from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .runtime.admin_keys import materialize_admin_keys

DEFAULT_CONFIG_FILENAME = "console_server.config.json"


@dataclass(frozen=True)
class ConsoleServerConfig:
    host: str
    port: int
    registry_base_url: str
    relay_base_url: str
    registry_admin_api_key: str
    relay_admin_api_key: str
    static_dir: Path
    registry_dir: Path
    relay_dir: Path
    registry_config_path: Path
    relay_config_path: Path
    python_executable: str | None

    @classmethod
    def from_dict(cls, value: dict) -> ConsoleServerConfig:
        host = _require_str(value.get("host"), "host", default="127.0.0.1")
        port = _require_int(value.get("port"), "port", default=8070)
        registry_base_url = _require_str(
            value.get("registryBaseUrl"),
            "registryBaseUrl",
            default="http://127.0.0.1:8080",
        ).rstrip("/")
        relay_base_url = _require_str(
            value.get("relayBaseUrl"),
            "relayBaseUrl",
            default="http://127.0.0.1:9090",
        ).rstrip("/")
        registry_admin_api_key = _require_str(
            value.get("registryAdminApiKey"),
            "registryAdminApiKey",
            default="",
        )
        relay_admin_api_key = _require_str(
            value.get("relayAdminApiKey"),
            "relayAdminApiKey",
            default=registry_admin_api_key,
        )
        static_dir = Path(
            _require_str(value.get("staticDir"), "staticDir", default="./static"),
        )
        registry_dir = Path(
            _require_str(value.get("registryDir"), "registryDir", default="../registry"),
        )
        relay_dir = Path(
            _require_str(value.get("relayDir"), "relayDir", default="../relay"),
        )
        registry_config_path = Path(
            _require_str(
                value.get("registryConfig"),
                "registryConfig",
                default="registry_server.config.json",
            ),
        )
        relay_config_path = Path(
            _require_str(
                value.get("relayConfig"),
                "relayConfig",
                default="relay_server.config.json",
            ),
        )
        python_executable = value.get("pythonExecutable")
        if python_executable is not None and not isinstance(python_executable, str):
            raise ValueError("pythonExecutable must be a string")
        return cls(
            host=host,
            port=port,
            registry_base_url=registry_base_url,
            relay_base_url=relay_base_url,
            registry_admin_api_key=registry_admin_api_key,
            relay_admin_api_key=relay_admin_api_key,
            static_dir=static_dir,
            registry_dir=registry_dir,
            relay_dir=relay_dir,
            registry_config_path=registry_config_path,
            relay_config_path=relay_config_path,
            python_executable=python_executable,
        )


def load_config(config_path: str | None = None) -> ConsoleServerConfig:
    env_path = os.environ.get("STATELESS_RELAY_CONSOLE_CONFIG")
    path = Path(config_path or env_path or DEFAULT_CONFIG_FILENAME)
    if not path.is_absolute():
        path = Path.cwd() / path

    if path.is_file():
        return _load_from_path(path)

    package_root = Path(__file__).resolve().parents[1]
    fallback = package_root / DEFAULT_CONFIG_FILENAME
    if fallback.is_file():
        return _load_from_path(fallback)

    raise FileNotFoundError(
        f"console config not found; copy console_server.config.example.json to "
        f"{DEFAULT_CONFIG_FILENAME}",
    )


def _load_from_path(path: Path) -> ConsoleServerConfig:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} root must be a JSON object")
    config = ConsoleServerConfig.from_dict(data)
    base_dir = path.parent

    def resolve_path(value: Path) -> Path:
        return value if value.is_absolute() else (base_dir / value).resolve()

    registry_dir = resolve_path(config.registry_dir)
    relay_dir = resolve_path(config.relay_dir)

    def resolve_service_config(value: Path, service_dir: Path) -> Path:
        if value.is_absolute():
            return value
        if (service_dir / value).is_file() or "/" not in str(value).replace("\\", "/"):
            return (service_dir / value).resolve()
        return (base_dir / value).resolve()

    registry_config_path = resolve_service_config(
        config.registry_config_path,
        registry_dir,
    )
    relay_config_path = resolve_service_config(
        config.relay_config_path,
        relay_dir,
    )

    registry_admin_api_key, relay_admin_api_key = materialize_admin_keys(
        registry_config_path=registry_config_path,
        relay_config_path=relay_config_path,
        console_registry_key=config.registry_admin_api_key,
        console_relay_key=config.relay_admin_api_key,
    )

    return ConsoleServerConfig(
        host=config.host,
        port=config.port,
        registry_base_url=config.registry_base_url,
        relay_base_url=config.relay_base_url,
        registry_admin_api_key=registry_admin_api_key,
        relay_admin_api_key=relay_admin_api_key,
        static_dir=resolve_path(config.static_dir),
        registry_dir=registry_dir,
        relay_dir=relay_dir,
        registry_config_path=registry_config_path,
        relay_config_path=relay_config_path,
        python_executable=config.python_executable,
    )


def _require_str(value: object, field: str, *, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value


def _require_int(value: object, field: str, *, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if value <= 0:
        raise ValueError(f"{field} must be positive")
    return value
