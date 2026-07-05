from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path


def _import_local_secrets():
    server_root = Path(__file__).resolve().parents[3]
    if str(server_root) not in sys.path:
        sys.path.insert(0, str(server_root))
    import local_secrets

    return local_secrets


def is_placeholder_key(value: str | None) -> bool:
    return _import_local_secrets().is_placeholder(value)


def materialize_admin_keys(
    *,
    registry_config_path: Path,
    relay_config_path: Path,
    console_registry_key: str,
    console_relay_key: str,
) -> tuple[str, str]:
    ls = _import_local_secrets()

    registry_secrets_path = ls.secrets_path_for_config(registry_config_path)
    relay_secrets_path = ls.secrets_path_for_config(relay_config_path)

    ls.migrate_secrets_from_config(
        registry_config_path,
        registry_secrets_path,
        ("adminApiKey",),
    )
    ls.migrate_secrets_from_config(
        relay_config_path,
        relay_secrets_path,
        ("adminApiKey",),
    )

    registry_key = ls.resolve_env_or_secret(
        os.environ.get("REGISTRY_ADMIN_API_KEY"),
        registry_secrets_path,
        "adminApiKey",
        lambda: secrets.token_urlsafe(32),
    )
    relay_key = ls.resolve_env_or_secret(
        os.environ.get("RELAY_ADMIN_API_KEY"),
        relay_secrets_path,
        "adminApiKey",
        lambda: secrets.token_urlsafe(32),
    )

    if not ls.is_placeholder(console_registry_key):
        registry_key = console_registry_key.strip()
        ls.set_secret(registry_secrets_path, "adminApiKey", registry_key)
    if not ls.is_placeholder(console_relay_key):
        relay_key = console_relay_key.strip()
        ls.set_secret(relay_secrets_path, "adminApiKey", relay_key)

    return registry_key, relay_key
