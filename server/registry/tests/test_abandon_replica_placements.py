from __future__ import annotations

import base64
from pathlib import Path

import pytest
import pytest_asyncio

from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.persistence.repository import RegistryRepository


def _test_config(database_path: Path) -> RegistryServerConfig:
    return RegistryServerConfig(
        host="127.0.0.1",
        port=8080,
        database_path=database_path,
        token_ttl_seconds=3600,
        registry_api_key_initial_uses=10,
        block_auth_master_key=base64.urlsafe_b64decode(
            base64.urlsafe_b64encode(b"0" * 32),
        ),
        allowlist=(
            AllowlistEntry("relay-a", "http://a.test"),
            AllowlistEntry("relay-b", "http://b.test"),
            AllowlistEntry("relay-c", "http://c.test"),
            AllowlistEntry("relay-d", "http://d.test"),
        ),
        stripe_target_relays=3,
        max_file_replica_count=1,
        max_replicas_per_block=2,
        relay_heartbeat_stale_seconds=3600,
    )


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> RegistryRepository:
    repo = RegistryRepository(tmp_path / "registry.db", _test_config(tmp_path / "registry.db"))
    await repo.initialize()
    for relay_id, relay_base_url, storage_rate in (
        ("relay-a", "http://a.test", 0.1),
        ("relay-b", "http://b.test", 0.2),
        ("relay-c", "http://c.test", 0.3),
        ("relay-d", "http://d.test", 0.4),
    ):
        await repo.upsert_relay_state(
            relay_id=relay_id,
            relay_base_url=relay_base_url,
            status="ok",
            stored_blocks=0,
            max_blocks=1000,
            storage_rate=storage_rate,
        )
    return repo


@pytest.mark.asyncio
async def test_abandon_replica_placements_removes_replica_only(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([("token-0", "hash-0")])
    removed = await repository.abandon_replica_placements([("token-0", "relay-b")])
    assert removed == [("token-0", "relay-b")]

    placements = await repository.get_token_placements("token-0")
    assert len(placements) == 1
    assert placements[0].role == "primary"


@pytest.mark.asyncio
async def test_abandon_replica_placements_with_two_block_file(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes(
        [("token-0", "hash-0"), ("token-1", "hash-1")],
    )
    removed = await repository.abandon_replica_placements(
        [("token-0", "relay-c"), ("token-1", "relay-d")],
    )
    assert set(removed) == {("token-0", "relay-c"), ("token-1", "relay-d")}

    token0 = await repository.get_token_placements("token-0")
    assert len(token0) == 1
    assert token0[0].role == "primary"

    resolved = await repository.get_resolve_targets("token-0")
    assert resolved is not None
    assert len(resolved.targets) == 1
    assert resolved.targets[0].role == "primary"


@pytest.mark.asyncio
async def test_abandon_replica_placements_ignores_primary(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([("token-0", "hash-0")])
    removed = await repository.abandon_replica_placements([("token-0", "relay-a")])
    assert removed == []

    placements = await repository.get_token_placements("token-0")
    assert any(item.role == "primary" for item in placements)
