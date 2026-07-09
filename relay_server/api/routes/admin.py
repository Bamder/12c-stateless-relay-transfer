from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ...config import RelayServerConfig
from ...domain.blocks import BlockService
from ...identity import RelayIdentityManager
from ...persistence.repository import BlockRepository
from ...registry.client import RegistryClient
from ...runtime.background import report_assigned_heartbeat
from ..admin_deps import require_admin_api_key


from pydantic import BaseModel, Field


RELAY_ADMIN_DB_PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "blocks": ("token",),
}


class RegistryUrlBody(BaseModel):
    url: str = Field(min_length=1)


class DeleteAdminDbRowRequest(BaseModel):
    table: str = Field(min_length=1)
    keys: dict[str, object]


def create_admin_router(
    *,
    config: RelayServerConfig,
    identity: RelayIdentityManager,
    repository: BlockRepository,
    blocks: BlockService,
    registry: RegistryClient,
) -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    @router.get("/overview")
    async def overview(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        stats = await blocks.stats()
        return {
            "relayId": identity.relay_id,
            "assignmentStatus": "assigned" if identity.is_assigned else "unassigned",
            "installId": identity.install_id,
            "publicBaseUrl": config.public_base_url,
            "storedBlocks": stats.stored_blocks,
            "maxBlocks": stats.max_blocks,
            "storageRate": stats.storage_rate,
            "blockMaxAgeSeconds": config.block_max_age_seconds,
            "blockSweepIntervalSeconds": config.block_sweep_interval_seconds,
        }

    @router.get("/identity")
    async def relay_identity(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        return {
            "installId": identity.install_id,
            "relayId": identity.relay_id,
            "assignmentStatus": "assigned" if identity.is_assigned else "unassigned",
            "publicBaseUrl": config.public_base_url,
        }

    @router.get("/db")
    async def admin_database(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        return await repository.export_admin_database()

    @router.post("/db/rows/delete")
    async def delete_admin_db_row(
        body: DeleteAdminDbRowRequest,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        try:
            deleted = await repository.delete_admin_db_row(
                table=body.table,
                keys=body.keys,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="row not found")
        return {"result": "deleted", "table": body.table, "keys": body.keys}

    @router.patch("/registry")
    async def patch_registry_url(
        body: RegistryUrlBody,
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        await registry.set_base_url(body.url)
        return {"registryUrl": registry.base_url}

    @router.post("/registration-request")
    async def submit_registration_request(
        _: None = Depends(require_admin_api_key),
    ) -> dict[str, object]:
        try:
            result = await registry.submit_registration_request()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=upstream_error_detail_from_response(exc.response),
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"registry unreachable: {exc}",
            ) from exc
        if identity.is_assigned:
            await report_assigned_heartbeat(identity, blocks, registry)
        return result

    return router


def upstream_error_detail_from_response(response: httpx.Response) -> str:
    detail = response.text.strip()
    if not detail:
        detail = response.reason_phrase or f"HTTP {response.status_code}"
    try:
        payload = response.json()
        if isinstance(payload, dict) and payload.get("detail") is not None:
            detail = str(payload["detail"])
    except Exception:
        pass
    return detail
