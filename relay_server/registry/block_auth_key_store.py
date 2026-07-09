from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .api_key_store import utc_now_iso


@dataclass
class BlockAuthKeyStore:
    block_auth_key_id: str
    block_auth_key: str
    updated_at: str


def load_block_auth_key_store(path: Path) -> BlockAuthKeyStore | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return BlockAuthKeyStore(
        block_auth_key_id=str(data["blockAuthKeyId"]),
        block_auth_key=str(data["blockAuthKey"]),
        updated_at=str(data.get("updatedAt", utc_now_iso())),
    )


def save_block_auth_key_store(path: Path, store: BlockAuthKeyStore) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "blockAuthKeyId": store.block_auth_key_id,
        "blockAuthKey": store.block_auth_key,
        "updatedAt": store.updated_at,
    }
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(path)


def delete_block_auth_key_store(path: Path) -> None:
    if path.is_file():
        path.unlink()
