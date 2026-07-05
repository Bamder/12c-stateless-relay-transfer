from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from .api_key_store import (
    RegistryApiKeyStore,
    delete_registry_api_key_store,
    decrypt_next_registry_api_key,
    load_or_create_rsa_private_pem,
    load_registry_api_key_store,
    private_key_to_public_pem,
    save_registry_api_key_store,
    utc_now_iso,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RegistryApiKeyCredentials:
    registry_api_key_id: str
    registry_api_key: str


class RegistryApiKeyManager:
    """管理 Relay ↔ Registry 对称 registryApiKey 及中继 RSA 公钥。"""

    def __init__(
        self,
        *,
        relay_rsa_key_path: Path,
        registry_api_key_store_path: Path,
        initial_remaining_uses: int = 100,
    ) -> None:
        self._relay_rsa_key_path = relay_rsa_key_path
        self._registry_api_key_store_path = registry_api_key_store_path
        self._initial_remaining_uses = initial_remaining_uses
        self._lock = asyncio.Lock()
        self._private_key_pem = load_or_create_rsa_private_pem(relay_rsa_key_path)
        self._store: RegistryApiKeyStore | None = load_registry_api_key_store(
            registry_api_key_store_path,
        )

    @property
    def relay_public_key_pem(self) -> str:
        return private_key_to_public_pem(self._private_key_pem)

    @property
    def has_registry_api_key(self) -> bool:
        return self._store is not None

    async def credentials(self) -> RegistryApiKeyCredentials:
        async with self._lock:
            if self._store is None:
                raise RuntimeError("registryApiKey not bootstrapped")
            return RegistryApiKeyCredentials(
                registry_api_key_id=self._store.registry_api_key_id,
                registry_api_key=self._store.registry_api_key,
            )

    async def invalidate(self) -> None:
        async with self._lock:
            self._store = None
            delete_registry_api_key_store(self._registry_api_key_store_path)
            logger.warning("registryApiKey store cleared; bootstrap required")

    async def apply_bootstrap(
        self,
        *,
        registry_api_key_id: str,
        registry_api_key: str,
        remaining_uses: int,
    ) -> None:
        async with self._lock:
            self._store = RegistryApiKeyStore(
                registry_api_key_id=registry_api_key_id,
                registry_api_key=registry_api_key,
                remaining_uses=remaining_uses,
                updated_at=utc_now_iso(),
            )
            save_registry_api_key_store(self._registry_api_key_store_path, self._store)
            logger.info(
                "registryApiKey bootstrapped keyId=%s uses=%s",
                registry_api_key_id,
                remaining_uses,
            )

    async def apply_heartbeat_response(self, payload: dict[str, object]) -> None:
        async with self._lock:
            bootstrap_key = payload.get("bootstrapRegistryApiKey")
            bootstrap_id = payload.get("bootstrapRegistryApiKeyId")
            if isinstance(bootstrap_key, str) and isinstance(bootstrap_id, str):
                remaining = payload.get("keyRemainingUses")
                uses = int(remaining) if isinstance(remaining, int) else self._initial_remaining_uses
                self._store = RegistryApiKeyStore(
                    registry_api_key_id=bootstrap_id,
                    registry_api_key=bootstrap_key,
                    remaining_uses=uses,
                    updated_at=utc_now_iso(),
                )
                save_registry_api_key_store(self._registry_api_key_store_path, self._store)
                logger.info("registryApiKey bootstrapped from heartbeat")
                return

            remaining = payload.get("keyRemainingUses")
            if self._store is not None and isinstance(remaining, int):
                self._store.remaining_uses = remaining
                self._store.updated_at = utc_now_iso()
                save_registry_api_key_store(self._registry_api_key_store_path, self._store)

            next_key = payload.get("nextRegistryApiKey")
            if isinstance(next_key, dict):
                encrypted = next_key.get("encryptedRegistryApiKey")
                key_id = next_key.get("registryApiKeyId")
                if not isinstance(encrypted, str) or not isinstance(key_id, str):
                    raise ValueError("invalid nextRegistryApiKey payload")
                plaintext = decrypt_next_registry_api_key(self._private_key_pem, encrypted)
                self._store = RegistryApiKeyStore(
                    registry_api_key_id=key_id,
                    registry_api_key=plaintext,
                    remaining_uses=self._initial_remaining_uses,
                    updated_at=utc_now_iso(),
                )
                save_registry_api_key_store(self._registry_api_key_store_path, self._store)
                logger.info("registryApiKey rotated keyId=%s", key_id)

    async def heartbeat_auth_fields(self) -> dict[str, str | None]:
        async with self._lock:
            if self._store is None:
                return {
                    "registryApiKeyId": None,
                    "registryApiKey": None,
                    "relayPublicKeyPem": self.relay_public_key_pem,
                }
            return {
                "registryApiKeyId": self._store.registry_api_key_id,
                "registryApiKey": self._store.registry_api_key,
                "relayPublicKeyPem": self.relay_public_key_pem,
            }
