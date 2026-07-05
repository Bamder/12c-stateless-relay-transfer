from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...persistence.repository import _PATCH_UNSET
from ...services.registry import (
    RegistryService,
    normalize_hash,
    normalize_token,
    serialize_allowlist_entry,
    serialize_registration_request,
    serialize_relay_overview,
)
from ..deps import require_admin_api_key, serialize_route
from ..schemas import (
    AbandonReplicaPlacementsRequest,
    AddAllowlistEntryRequest,
    DeleteAdminDbRowRequest,
    HeartbeatRequest,
    PatchAllowlistEntryRequest,
    RegisterRequest,
    ApproveRegistrationRequest,
    RegistrationRequestBody,
    ReserveTokensRequest,
    ResolveRequest,
    VerifyOverwriteRequest,
)


def create_relay_router(service: RegistryService) -> APIRouter:
    router = APIRouter(prefix="/api/relay", tags=["relay"])

    @router.post("/resolve")
    async def resolve(body: ResolveRequest) -> dict[str, list[dict[str, object]]]:
        tokens = [normalize_token(token) for token in body.tokens]
        routes = await service.resolve_download_routes(tokens)
        return {
            "routes": [serialize_route(route) for route in routes],
        }

    @router.post("/reserve-tokens")
    async def reserve_tokens(body: ReserveTokensRequest) -> dict[str, list[dict[str, object]]]:
        if not body.blocks:
            raise HTTPException(status_code=400, detail="blocks must not be empty")
        entries: list[tuple[str, str]] = []
        for block in body.blocks:
            token = normalize_token(block.token)
            block_hash = normalize_hash(block.blockHash)
            entries.append((token, block_hash))
        routes = await service.reserve_upload_blocks(entries, ttl_seconds=body.ttlSeconds)
        return {
            "routes": [serialize_route(route) for route in routes],
        }

    @router.post("/abandon-replica-placements")
    async def abandon_replica_placements(
        body: AbandonReplicaPlacementsRequest,
    ) -> dict[str, list[dict[str, str]]]:
        if not body.failures:
            raise HTTPException(status_code=400, detail="failures must not be empty")
        entries = [(item.token, item.relayId) for item in body.failures]
        removed = await service.abandon_replica_placements(entries)
        return {"removed": removed}

    @router.post("/register")
    async def register_route(body: RegisterRequest) -> dict[str, bool]:
        token = normalize_token(body.token)
        block_hash = normalize_hash(body.blockHash)
        await service.register_block_from_relay(
            relay_id=body.relayId,
            relay_base_url=body.relayBaseUrl.rstrip("/"),
            token=token,
            block_hash=block_hash,
            registry_api_key_id=body.registryApiKeyId,
            registry_api_key=body.registryApiKey,
        )
        return {"ok": True}

    @router.post("/verify-overwrite")
    async def verify_overwrite(body: VerifyOverwriteRequest) -> dict[str, str]:
        token = normalize_token(body.token)
        block_hash = normalize_hash(body.blockHash)
        result = await service.verify_overwrite(
            relay_id=body.relayId,
            relay_base_url=body.relayBaseUrl.rstrip("/"),
            token=token,
            block_hash=block_hash,
            registry_api_key_id=body.registryApiKeyId,
            registry_api_key=body.registryApiKey,
        )
        return {
            "blockHash": result.block_hash,
            "blockAuthKeyId": result.block_auth_key_id,
            "blockAuthMac": result.block_auth_mac,
            "blockAuthAlgorithm": result.block_auth_algorithm,
            "expiryAt": result.expiry_at,
        }

    @router.post("/heartbeat")
    async def heartbeat(body: HeartbeatRequest) -> dict[str, object]:
        result = await service.process_heartbeat(
            relay_id=body.relayId,
            relay_base_url=body.relayBaseUrl.rstrip("/"),
            status=body.status,
            stored_blocks=body.storedBlocks,
            max_blocks=body.maxBlocks,
            storage_rate=body.storageRate,
            registry_api_key_id=body.registryApiKeyId,
            registry_api_key=body.registryApiKey,
            relay_public_key_pem=body.relayPublicKeyPem,
        )
        payload: dict[str, object] = {
            "ok": result.ok,
            "keyRemainingUses": result.key_remaining_uses,
        }
        if result.bootstrap_registry_api_key is not None:
            payload["bootstrapRegistryApiKey"] = result.bootstrap_registry_api_key
            payload["bootstrapRegistryApiKeyId"] = result.bootstrap_key_id
        if result.bootstrap_block_auth_key is not None:
            payload["bootstrapBlockAuthKey"] = result.bootstrap_block_auth_key
            payload["bootstrapBlockAuthKeyId"] = result.bootstrap_block_auth_key_id
        if result.next_registry_api_key is not None:
            payload["nextRegistryApiKey"] = {
                "registryApiKeyId": result.next_registry_api_key.key_id,
                "encryptedRegistryApiKey": result.next_registry_api_key.encrypted_key,
                "algorithm": result.next_registry_api_key.algorithm,
            }
        if result.next_block_auth_key is not None:
            payload["nextBlockAuthKey"] = {
                "blockAuthKeyId": result.next_block_auth_key.key_id,
                "encryptedBlockAuthKey": result.next_block_auth_key.encrypted_key,
                "algorithm": result.next_block_auth_key.algorithm,
            }
        return payload

    @router.post("/registration-request")
    async def registration_request(body: RegistrationRequestBody) -> dict[str, object]:
        return await service.submit_registration_request(
            install_id=body.installId,
            relay_base_url=body.relayBaseUrl.rstrip("/"),
            relay_public_key_pem=body.relayPublicKeyPem,
        )

    @router.get("/registration-status")
    async def registration_status(installId: str) -> dict[str, object]:
        return await service.get_registration_status(installId)

    return router


def create_admin_router(service: RegistryService) -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    @router.get("/relays/overview")
    async def relay_overview(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, list[dict[str, object]]]:
        overviews = await service.list_relay_overviews()
        return {
            "relays": [serialize_relay_overview(item) for item in overviews],
        }

    @router.get("/db")
    async def admin_database(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        return await service.export_admin_database()

    @router.post("/db/rows/delete")
    async def delete_admin_db_row(
        body: DeleteAdminDbRowRequest,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        await service.delete_admin_db_row(table=body.table, keys=body.keys)
        return {"result": "deleted", "table": body.table, "keys": body.keys}

    @router.get("/allowlist")
    async def list_allowlist(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, list[dict[str, object]]]:
        entries = await service.list_allowlist_entries()
        return {
            "entries": [serialize_allowlist_entry(entry) for entry in entries],
        }

    @router.post("/allowlist")
    async def add_allowlist_entry(
        body: AddAllowlistEntryRequest,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, dict[str, object]]:
        entry = await service.add_allowlist_entry(
            relay_id=body.relayId,
            relay_base_url=body.relayBaseUrl.rstrip("/") if body.relayBaseUrl else None,
        )
        return {"entry": serialize_allowlist_entry(entry)}

    @router.patch("/allowlist/{relay_id}")
    async def patch_allowlist_entry(
        relay_id: str,
        body: PatchAllowlistEntryRequest,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, dict[str, object]]:
        updates = body.model_dump(exclude_unset=True)
        relay_base_url = body.relayBaseUrl if "relayBaseUrl" in updates else _PATCH_UNSET
        enabled = body.enabled if "enabled" in updates else None
        entry = await service.patch_allowlist_entry(
            relay_id,
            relay_base_url=relay_base_url,
            enabled=enabled,
        )
        return {"entry": serialize_allowlist_entry(entry)}

    @router.delete("/allowlist/{relay_id}")
    async def delete_allowlist_entry(
        relay_id: str,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        await service.remove_allowlist_entry(relay_id)
        return {"result": "deleted", "relayId": relay_id}

    @router.get("/registration-requests")
    async def list_registration_requests(
        status: str = "pending",
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        requests = await service.list_registration_requests(status=status)
        pending_count = await service.count_pending_registration_requests()
        return {
            "requests": [
                serialize_registration_request(item) for item in requests
            ],
            "pendingCount": pending_count,
        }

    @router.post("/registration-requests/{install_id}/approve")
    async def approve_registration_request(
        install_id: str,
        body: ApproveRegistrationRequest | None = None,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        entry = await service.approve_registration_request(
            install_id,
            relay_id=body.relayId if body is not None else None,
        )
        return {"entry": serialize_allowlist_entry(entry), "relayId": entry.relay_id}

    @router.post("/registration-requests/{install_id}/ignore")
    async def ignore_registration_request(
        install_id: str,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        await service.ignore_registration_request(install_id)
        return {"result": "ignored", "installId": install_id}

    return router
