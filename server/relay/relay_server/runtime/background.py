from __future__ import annotations

import asyncio
import logging

from ..config import RelayServerConfig
from ..domain.blocks import BlockService
from ..identity import RelayIdentityManager
from ..registry.client import RegistryClient
from ..registry.connectivity import record_registry_failure, record_registry_success

logger = logging.getLogger(__name__)


async def run_startup_auto_registration(
    identity: RelayIdentityManager,
    blocks: BlockService,
    registry: RegistryClient,
    settings: RelayServerConfig,
) -> None:
    if not settings.registry.auto_register_on_startup:
        return
    try:
        await sync_relay_assignment_from_registry(identity, registry)
        if identity.is_assigned:
            return
        result = await registry.submit_registration_request()
        logger.info(
            "startup auto registration submitted install=%s status=%s",
            identity.install_id,
            result.get("status"),
        )
        if identity.is_assigned:
            await report_assigned_heartbeat(identity, blocks, registry, settings)
        record_registry_success()
    except Exception as exc:
        record_registry_failure(exc)
        logger.exception(
            "startup auto registration failed install=%s",
            identity.install_id,
        )


async def run_block_sweep(blocks: BlockService, settings: RelayServerConfig) -> None:
    try:
        result = await blocks.sweep_expired_blocks()
        if result.total_removed > 0:
            logger.info(
                "block sweep removed db=%s orphan=%s maxAgeSeconds=%s",
                result.expired_from_db,
                result.orphan_files,
                settings.block_max_age_seconds,
            )
    except Exception:
        logger.exception("block sweep failed")


async def report_assigned_heartbeat(
    identity: RelayIdentityManager,
    blocks: BlockService,
    registry: RegistryClient,
    settings: RelayServerConfig,
) -> None:
    stats = await blocks.stats()
    result = await registry.report_heartbeat(
        stored_blocks=stats.stored_blocks,
        max_blocks=stats.max_blocks,
        storage_rate=stats.storage_rate,
        block_max_age_seconds=settings.block_max_age_seconds,
        block_sweep_interval_seconds=settings.block_sweep_interval_seconds,
    )
    if result.get("notAllowlisted"):
        logger.info(
            "relay not on allowlist relay=%s stored=%s",
            identity.relay_id,
            stats.stored_blocks,
        )
    elif not result.get("notAssigned"):
        logger.info(
            "heartbeat ok relay=%s stored=%s rate=%.4f",
            identity.relay_id,
            stats.stored_blocks,
            stats.storage_rate,
        )


async def sync_relay_assignment_from_registry(
    identity: RelayIdentityManager,
    registry: RegistryClient,
) -> None:
    status_payload = await registry.fetch_registration_status()
    status = status_payload.get("status")
    relay_id = status_payload.get("relayId")

    if status == "approved" and isinstance(relay_id, str) and relay_id.strip():
        normalized = relay_id.strip()
        if identity.relay_id != normalized:
            if identity.is_assigned:
                logger.info(
                    "relay id reassigned old=%s new=%s install=%s",
                    identity.relay_id,
                    normalized,
                    identity.install_id,
                )
            else:
                logger.info(
                    "relay id assigned relay=%s install=%s",
                    normalized,
                    identity.install_id,
                )
            await registry.invalidate_secrets()
            identity.assign_relay_id(normalized)
        return

    if status == "ignored":
        if identity.is_assigned:
            await registry.invalidate_secrets()
            identity.clear_relay_id()
            logger.info(
                "relay id cleared after ignore install=%s",
                identity.install_id,
            )
        else:
            logger.info("registration ignored install=%s", identity.install_id)
        return

    if identity.is_assigned:
        await registry.invalidate_secrets()
        identity.clear_relay_id()
        logger.info(
            "relay id cleared install=%s registry_status=%s",
            identity.install_id,
            status,
        )


async def relay_registry_loop(
    identity: RelayIdentityManager,
    blocks: BlockService,
    registry: RegistryClient,
    settings: RelayServerConfig,
) -> None:
    while True:
        try:
            await sync_relay_assignment_from_registry(identity, registry)
            if identity.is_assigned:
                await report_assigned_heartbeat(identity, blocks, registry, settings)
            record_registry_success()
        except Exception as exc:
            record_registry_failure(exc)
            logger.exception("relay registry sync failed install=%s", identity.install_id)
        await asyncio.sleep(settings.heartbeat_interval_seconds)


async def sweep_loop(blocks: BlockService, settings: RelayServerConfig) -> None:
    while True:
        await asyncio.sleep(settings.block_sweep_interval_seconds)
        await run_block_sweep(blocks, settings)


def start_background_tasks(
    identity: RelayIdentityManager,
    blocks: BlockService,
    registry: RegistryClient,
    settings: RelayServerConfig,
) -> tuple[asyncio.Task[None], asyncio.Task[None]]:
    registry_task = asyncio.create_task(
        relay_registry_loop(identity, blocks, registry, settings),
    )
    sweep_task = asyncio.create_task(sweep_loop(blocks, settings))
    return registry_task, sweep_task


async def stop_background_tasks(*tasks: asyncio.Task[None] | None) -> None:
    for task in tasks:
        if task is None:
            continue
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
