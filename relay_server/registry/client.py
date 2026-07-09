from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..identity import RelayIdentityManager
from .block_auth_key_manager import BlockAuthKeyManager
from .api_key_manager import RegistryApiKeyManager


def _create_registry_http_client(
    base_url: str,
    *,
    http_proxy: str | None = None,
) -> httpx.AsyncClient:
    kwargs: dict[str, object] = {
        "base_url": base_url.rstrip("/"),
        "timeout": 10.0,
        "trust_env": False,
    }
    if http_proxy is not None:
        kwargs["proxy"] = http_proxy
    return httpx.AsyncClient(**kwargs)


@dataclass(frozen=True)
class VerifyOverwriteResult:
    block_hash: str
    block_auth_key_id: str
    block_auth_mac: str
    block_auth_algorithm: str
    expiry_at: str


class RegistryClient:
    """中继 → 注册服务器 HTTP 客户端（携带 registryApiKey）。"""

    def __init__(
        self,
        *,
        base_url: str,
        identity: RelayIdentityManager,
        relay_base_url: str,
        registry_api_keys: RegistryApiKeyManager,
        block_auth_keys: BlockAuthKeyManager,
        http_proxy: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._identity = identity
        self._relay_base_url = relay_base_url.rstrip("/")
        self._http_proxy = http_proxy
        self._registry_api_keys = registry_api_keys
        self._block_auth_keys = block_auth_keys
        self._client = _create_registry_http_client(
            self._base_url,
            http_proxy=self._http_proxy,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def set_base_url(self, url: str) -> None:
        normalized = url.rstrip("/")
        self._base_url = normalized
        await self._client.aclose()
        self._client = _create_registry_http_client(
            self._base_url,
            http_proxy=self._http_proxy,
        )

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def http_proxy(self) -> str | None:
        return self._http_proxy

    def _assigned_relay_id(self) -> str | None:
        return self._identity.relay_id

    def _require_assigned_relay_id(self) -> str:
        relay_id = self._assigned_relay_id()
        if not relay_id:
            raise RuntimeError("relay id not assigned by registry")
        return relay_id

    async def invalidate_secrets(self) -> None:
        await self._registry_api_keys.invalidate()
        await self._block_auth_keys.invalidate()

    async def ensure_secrets(self) -> None:
        if not self._identity.is_assigned:
            return
        if (
            self._registry_api_keys.has_registry_api_key
            and self._block_auth_keys.has_block_auth_key
        ):
            return
        result = await self.report_heartbeat(
            stored_blocks=0,
            max_blocks=1,
            storage_rate=0.0,
        )
        if result.get("notAllowlisted"):
            return

    async def reset_assignment_for_registration(self) -> None:
        await self.invalidate_secrets()
        self._identity.clear_relay_id()

    async def submit_registration_request(self) -> dict[str, object]:
        await self.reset_assignment_for_registration()
        auth_fields = await self._registry_api_keys.heartbeat_auth_fields()
        response = await self._client.post(
            "/api/relay/registration-request",
            json={
                "installId": self._identity.install_id,
                "relayBaseUrl": self._relay_base_url,
                "relayPublicKeyPem": auth_fields["relayPublicKeyPem"],
            },
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("registration-request response must be an object")
        relay_id = body.get("relayId")
        status = body.get("status")
        if (
            status == "already_allowlisted"
            and isinstance(relay_id, str)
            and relay_id.strip()
        ):
            self._identity.assign_relay_id(relay_id.strip())
        return body

    async def fetch_registration_status(self) -> dict[str, object]:
        response = await self._client.get(
            "/api/relay/registration-status",
            params={"installId": self._identity.install_id},
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("registration-status response must be an object")
        return body

    async def _relay_payload(self) -> dict[str, str]:
        relay_id = self._require_assigned_relay_id()
        credentials = await self._registry_api_keys.credentials()
        return {
            "relayId": relay_id,
            "relayBaseUrl": self._relay_base_url,
            "registryApiKeyId": credentials.registry_api_key_id,
            "registryApiKey": credentials.registry_api_key,
        }

    async def register_block(self, *, token: str, block_hash: str) -> None:
        await self.ensure_secrets()
        payload = await self._relay_payload()
        payload.update({"token": token, "blockHash": block_hash})
        response = await self._client.post("/api/relay/register", json=payload)
        if response.status_code == 401:
            await self._registry_api_keys.invalidate()
            await self.ensure_secrets()
            payload = await self._relay_payload()
            payload.update({"token": token, "blockHash": block_hash})
            response = await self._client.post("/api/relay/register", json=payload)
        response.raise_for_status()

    async def verify_overwrite(
        self,
        *,
        token: str,
        block_hash: str,
    ) -> VerifyOverwriteResult:
        await self.ensure_secrets()
        payload = await self._relay_payload()
        payload.update({"token": token, "blockHash": block_hash})
        response = await self._client.post("/api/relay/verify-overwrite", json=payload)
        if response.status_code == 401:
            await self._registry_api_keys.invalidate()
            await self.ensure_secrets()
            payload = await self._relay_payload()
            payload.update({"token": token, "blockHash": block_hash})
            response = await self._client.post("/api/relay/verify-overwrite", json=payload)
        response.raise_for_status()
        body = response.json()
        block_hash_value = body.get("blockHash")
        block_auth_key_id = body.get("blockAuthKeyId")
        block_auth_mac = body.get("blockAuthMac")
        block_auth_algorithm = body.get("blockAuthAlgorithm")
        expiry_at = body.get("expiryAt")
        if (
            not isinstance(block_hash_value, str)
            or not block_hash_value
            or not isinstance(block_auth_key_id, str)
            or not block_auth_key_id
            or not isinstance(block_auth_mac, str)
            or not block_auth_mac
            or not isinstance(block_auth_algorithm, str)
            or not block_auth_algorithm
            or not isinstance(expiry_at, str)
            or not expiry_at
        ):
            raise ValueError("registry verify-overwrite missing block auth fields")
        return VerifyOverwriteResult(
            block_hash=block_hash_value.lower(),
            block_auth_key_id=block_auth_key_id,
            block_auth_mac=block_auth_mac.lower(),
            block_auth_algorithm=block_auth_algorithm,
            expiry_at=expiry_at,
        )

    async def report_heartbeat(
        self,
        *,
        stored_blocks: int,
        max_blocks: int,
        storage_rate: float,
    ) -> dict[str, object]:
        relay_id = self._assigned_relay_id()
        if not relay_id:
            return {"notAssigned": True}
        auth_fields = await self._registry_api_keys.heartbeat_auth_fields()
        response = await self._client.post(
            "/api/relay/heartbeat",
            json={
                "relayId": relay_id,
                "relayBaseUrl": self._relay_base_url,
                "status": "ok",
                "storedBlocks": stored_blocks,
                "maxBlocks": max_blocks,
                "storageRate": storage_rate,
                "registryApiKeyId": auth_fields["registryApiKeyId"],
                "registryApiKey": auth_fields["registryApiKey"],
                "relayPublicKeyPem": auth_fields["relayPublicKeyPem"],
            },
        )
        if response.status_code == 403:
            return {"notAllowlisted": True}
        if response.status_code == 401 and auth_fields["registryApiKeyId"] is not None:
            await self._registry_api_keys.invalidate()
            auth_fields = await self._registry_api_keys.heartbeat_auth_fields()
            response = await self._client.post(
                "/api/relay/heartbeat",
                json={
                    "relayId": relay_id,
                    "relayBaseUrl": self._relay_base_url,
                    "status": "ok",
                    "storedBlocks": stored_blocks,
                    "maxBlocks": max_blocks,
                    "storageRate": storage_rate,
                    "registryApiKeyId": auth_fields["registryApiKeyId"],
                    "registryApiKey": auth_fields["registryApiKey"],
                    "relayPublicKeyPem": auth_fields["relayPublicKeyPem"],
                },
            )
            if response.status_code == 403:
                return {"notAllowlisted": True}
        response.raise_for_status()
        payload = response.json()
        await self._registry_api_keys.apply_heartbeat_response(payload)
        await self._block_auth_keys.apply_heartbeat_response(payload)
        return payload if isinstance(payload, dict) else {"ok": True}
