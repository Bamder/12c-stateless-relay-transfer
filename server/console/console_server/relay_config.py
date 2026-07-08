from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException


def read_relay_registry_url(relay_config_path: Path) -> str | None:
    data = _load_relay_config(relay_config_path)
    registry = data.get("registry")
    if not isinstance(registry, dict):
        return None
    url = registry.get("url")
    if not isinstance(url, str) or not url.strip():
        return None
    return url.rstrip("/")


def read_relay_public_base_url(relay_config_path: Path) -> tuple[str, int]:
    data = _load_relay_config(relay_config_path)
    port = data.get("port", 9090)
    if isinstance(port, bool) or not isinstance(port, int):
        port = 9090
    base_url = data.get("publicBaseUrl")
    if not isinstance(base_url, str) or not base_url.strip():
        base_url = f"http://127.0.0.1:{port}"
    return base_url.rstrip("/"), port


def write_relay_public_base_url(relay_config_path: Path, public_base_url: str) -> str:
    normalized = _normalize_public_base_url(public_base_url)
    data = _load_relay_config(relay_config_path)
    data["publicBaseUrl"] = normalized
    relay_config_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return normalized


def write_relay_registry_url(relay_config_path: Path, registry_url: str) -> str:
    normalized = registry_url.strip().rstrip("/")
    if not normalized:
        raise HTTPException(status_code=400, detail="registryUrl must be non-empty")
    data = _load_relay_config(relay_config_path)
    registry = data.get("registry")
    if not isinstance(registry, dict):
        registry = {}
        data["registry"] = registry
    registry["url"] = normalized
    relay_config_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return normalized


def _normalize_public_base_url(public_base_url: str) -> str:
    normalized = public_base_url.strip().rstrip("/")
    if not normalized:
        raise HTTPException(status_code=400, detail="publicBaseUrl must be non-empty")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail="publicBaseUrl must be a valid http(s) URL",
        )
    return normalized


def _load_relay_config(relay_config_path: Path) -> dict[str, object]:
    if not relay_config_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"relay config not found: {relay_config_path}",
        )
    with relay_config_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="relay config must be a JSON object")
    return data
