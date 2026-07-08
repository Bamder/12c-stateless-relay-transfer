from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from relay_server.config import RegistryConfig, RelayServerConfig
from relay_server.identity import RelayIdentityManager
from relay_server.runtime.background import (
    relay_registry_loop,
    report_assigned_heartbeat,
    sync_relay_assignment_from_registry,
)


def _settings(tmp_path: Path) -> RelayServerConfig:
    return RelayServerConfig(
        host="0.0.0.0",
        port=9090,
        public_base_url="http://127.0.0.1:9090",
        max_body_bytes=1024,
        max_blocks=100,
        data_dir=tmp_path / "blocks",
        database_path=tmp_path / "relay.db",
        heartbeat_interval_seconds=3600,
        registry=RegistryConfig(url="http://127.0.0.1:8080"),
        secrets_dir=tmp_path / "secrets",
        relay_rsa_key_path=tmp_path / "secrets" / "relay_rsa.pem",
        registry_api_key_store_path=tmp_path / "secrets" / "registry_api_key.json",
        registry_api_key_initial_uses=100,
        block_auth_key_store_path=tmp_path / "secrets" / "block_auth_key.json",
        block_max_age_seconds=86400,
        block_sweep_interval_seconds=3600,
    )


class BackgroundRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_report_assigned_heartbeat_forwards_stats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = _settings(Path(tmp))
            identity = MagicMock()
            identity.relay_id = "relay-test"
            blocks = MagicMock()
            blocks.stats = AsyncMock(
                return_value=MagicMock(stored_blocks=3, max_blocks=100, storage_rate=0.03),
            )
            registry = MagicMock()
            registry.report_heartbeat = AsyncMock(return_value={"ok": True})

            await report_assigned_heartbeat(identity, blocks, registry, settings)

            registry.report_heartbeat.assert_awaited_once_with(
                stored_blocks=3,
                max_blocks=100,
                storage_rate=0.03,
                block_max_age_seconds=86400,
                block_sweep_interval_seconds=3600,
            )

    async def test_assignment_triggers_immediate_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            settings = _settings(tmp_path)
            identity = RelayIdentityManager(settings.secrets_dir)
            identity.load()

            blocks = MagicMock()
            blocks.stats = AsyncMock(
                return_value=MagicMock(stored_blocks=0, max_blocks=100, storage_rate=0.0),
            )
            registry = MagicMock()
            registry.fetch_registration_status = AsyncMock(
                return_value={"status": "approved", "relayId": "relay-assigned"},
            )
            registry.invalidate_secrets = AsyncMock()
            registry.report_heartbeat = AsyncMock(return_value={"ok": True})

            task = asyncio.create_task(
                relay_registry_loop(identity, blocks, registry, settings),
            )
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

            self.assertEqual(identity.relay_id, "relay-assigned")
            registry.report_heartbeat.assert_awaited_once()

    async def test_reassignment_updates_local_relay_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            settings = _settings(tmp_path)
            identity = RelayIdentityManager(settings.secrets_dir)
            identity.load()
            identity.assign_relay_id("relay-old")

            registry = MagicMock()
            registry.fetch_registration_status = AsyncMock(
                return_value={"status": "approved", "relayId": "relay-new"},
            )
            registry.invalidate_secrets = AsyncMock()
            registry.report_heartbeat = AsyncMock(return_value={"ok": True})

            await sync_relay_assignment_from_registry(identity, registry)

            self.assertEqual(identity.relay_id, "relay-new")
            registry.invalidate_secrets.assert_awaited_once()

    async def test_pending_registry_status_clears_stale_local_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            settings = _settings(tmp_path)
            identity = RelayIdentityManager(settings.secrets_dir)
            identity.load()
            identity.assign_relay_id("relay-stale")

            registry = MagicMock()
            registry.fetch_registration_status = AsyncMock(
                return_value={"status": "pending", "relayId": None},
            )
            registry.invalidate_secrets = AsyncMock()

            await sync_relay_assignment_from_registry(identity, registry)

            self.assertIsNone(identity.relay_id)
            registry.invalidate_secrets.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
