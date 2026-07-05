from __future__ import annotations

import json
import secrets
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

T = TypeVar("T")

PLACEHOLDER_PREFIX = "REPLACE_WITH"


def is_placeholder(value: object) -> bool:
    if not isinstance(value, str):
        return True
    stripped = value.strip()
    if not stripped:
        return True
    return stripped.startswith(PLACEHOLDER_PREFIX)


def secrets_path_for_config(config_path: Path) -> Path:
    name = config_path.name
    if name.endswith(".config.json"):
        secret_name = name.replace(".config.json", ".secrets.json")
    else:
        secret_name = f"{config_path.stem}.secrets.json"
    return config_path.with_name(secret_name)


def read_secrets(path: Path) -> dict[str, object]:
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} root must be a JSON object")
    return data


def write_secrets(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def ensure_secret(
    secrets_path: Path,
    key: str,
    factory: Callable[[], str],
) -> str:
    data = read_secrets(secrets_path)
    existing = data.get(key)
    if isinstance(existing, str) and not is_placeholder(existing):
        return existing.strip()
    value = factory()
    data[key] = value
    write_secrets(secrets_path, data)
    return value


def migrate_secrets_from_config(
    config_path: Path,
    secrets_path: Path,
    keys: tuple[str, ...],
) -> None:
    if not config_path.is_file():
        return
    with config_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return

    secrets_data = read_secrets(secrets_path)
    secrets_changed = False
    config_changed = False

    for key in keys:
        config_value = data.get(key)
        if isinstance(config_value, str) and not is_placeholder(config_value):
            existing = secrets_data.get(key)
            if not isinstance(existing, str) or is_placeholder(existing):
                secrets_data[key] = config_value.strip()
                secrets_changed = True
        if key in data:
            del data[key]
            config_changed = True

    if secrets_changed:
        write_secrets(secrets_path, secrets_data)
    if config_changed:
        with config_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")


def strip_secret_keys_from_config(config_path: Path, keys: tuple[str, ...]) -> None:
    if not config_path.is_file():
        return
    with config_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return
    removed = any(key in data for key in keys)
    if not removed:
        return
    for key in keys:
        data.pop(key, None)
    with config_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def set_secret(secrets_path: Path, key: str, value: str) -> None:
    data = read_secrets(secrets_path)
    data[key] = value.strip()
    write_secrets(secrets_path, data)


def resolve_env_or_secret(
    env_value: str | None,
    secrets_path: Path,
    secret_key: str,
    factory: Callable[[], str],
) -> str:
    if env_value and env_value.strip():
        return env_value.strip()
    return ensure_secret(secrets_path, secret_key, factory)
