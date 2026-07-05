from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from ..crypto.block_auth import decode_block_auth_key
from .block_auth_key_store import (
    BlockAuthKeyStore,
    delete_block_auth_key_store,
    load_block_auth_key_store,
    save_block_auth_key_store,
)
from .api_key_store import (
    decrypt_secret_bytes,
    load_or_create_rsa_private_pem,
    utc_now_iso,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BlockAuthKeyCredentials:
    block_auth_key_id: str
    block_auth_key: bytes


class BlockAuthKeyManager:
    """管理 Relay 本地 blockAuthKey（Registry HKDF 派生，RSA 轮换下发）。"""

    def __init__(
        self,
        *,
        relay_rsa_key_path: Path,
        block_auth_key_store_path: Path,
    ) -> None:
        self._relay_rsa_key_path = relay_rsa_key_path
        self._block_auth_key_store_path = block_auth_key_store_path
        self._lock = asyncio.Lock()
        self._private_key_pem = load_or_create_rsa_private_pem(relay_rsa_key_path)
        self._store: BlockAuthKeyStore | None = load_block_auth_key_store(
            block_auth_key_store_path,
        )

    @property
    def has_block_auth_key(self) -> bool:
        return self._store is not None

    async def credentials(self) -> BlockAuthKeyCredentials:
        async with self._lock:
            if self._store is None:
                raise RuntimeError("blockAuthKey not bootstrapped")
            return BlockAuthKeyCredentials(
                block_auth_key_id=self._store.block_auth_key_id,
                block_auth_key=decode_block_auth_key(self._store.block_auth_key),
            )

    async def invalidate(self) -> None:
        async with self._lock:
            self._store = None
            delete_block_auth_key_store(self._block_auth_key_store_path)
            logger.warning("blockAuthKey store cleared; bootstrap required")

    async def apply_heartbeat_response(self, payload: dict[str, object]) -> None:
        async with self._lock:
            bootstrap_key = payload.get("bootstrapBlockAuthKey")
            bootstrap_id = payload.get("bootstrapBlockAuthKeyId")
            if isinstance(bootstrap_key, str) and isinstance(bootstrap_id, str):
                self._store = BlockAuthKeyStore(
                    block_auth_key_id=bootstrap_id,
                    block_auth_key=bootstrap_key,
                    updated_at=utc_now_iso(),
                )
                save_block_auth_key_store(self._block_auth_key_store_path, self._store)
                logger.info("blockAuthKey bootstrapped from heartbeat keyId=%s", bootstrap_id)

            next_key = payload.get("nextBlockAuthKey")
            if isinstance(next_key, dict):
                encrypted = next_key.get("encryptedBlockAuthKey")
                key_id = next_key.get("blockAuthKeyId")
                if not isinstance(encrypted, str) or not isinstance(key_id, str):
                    raise ValueError("invalid nextBlockAuthKey payload")
                key_bytes = decrypt_secret_bytes(self._private_key_pem, encrypted)
                encoded = _encode_block_auth_key(key_bytes)
                self._store = BlockAuthKeyStore(
                    block_auth_key_id=key_id,
                    block_auth_key=encoded,
                    updated_at=utc_now_iso(),
                )
                save_block_auth_key_store(self._block_auth_key_store_path, self._store)
                logger.info("blockAuthKey rotated keyId=%s", key_id)


def _encode_block_auth_key(key_bytes: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(key_bytes).decode("ascii")
