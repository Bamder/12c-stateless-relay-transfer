from __future__ import annotations

import json
from pathlib import Path

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
