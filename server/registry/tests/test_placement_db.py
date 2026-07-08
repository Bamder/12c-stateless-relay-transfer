from __future__ import annotations

import base64
from pathlib import Path

import pytest
import pytest_asyncio

from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.persistence.repository import RegistryRepository, TokenOccupiedError, TokenReserveResult
from tests.registry_fixtures import DEFAULT_TEST_PLACEMENT_POLICY


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
        placement_policy=DEFAULT_TEST_PLACEMENT_POLICY,
        relay_heartbeat_stale_seconds=3600,
    )


def primary_url(result: TokenReserveResult) -> str:
    return next(
        target.relay_base_url for target in result.targets if target.role == "primary"
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
async def test_lock_tokens_stripes_with_replicas_when_four_relays(
    repository: RegistryRepository,
) -> None:
    entries = [
        ("token-0", "hash-0"),
        ("token-1", "hash-1"),
        ("token-2", "hash-2"),
    ]
    results = (await repository.lock_tokens_with_block_hashes(entries)).routes
    assert len(results) == 3
    assert primary_url(results[0]) == "http://a.test"
    assert primary_url(results[1]) == "http://b.test"
    assert primary_url(results[2]) == "http://a.test"
    assert all(len(item.targets) == 2 for item in results)


@pytest.mark.asyncio
async def test_lock_tokens_adds_replica_with_four_relays(
    repository: RegistryRepository,
) -> None:
    entries = [("token-0", "hash-0"), ("token-1", "hash-1")]
    results = (await repository.lock_tokens_with_block_hashes(entries)).routes
    assert len(results) == 2
    assert results[0].targets[0].relay_base_url == "http://a.test"
    assert results[0].targets[1].role == "replica"
    assert results[0].targets[1].relay_base_url == "http://c.test"
    assert results[1].targets[0].relay_base_url == "http://b.test"
    assert results[1].targets[1].relay_base_url == "http://d.test"


@pytest.mark.asyncio
async def test_lock_tokens_rejects_occupied_primary(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([("token-0", "hash-0")])
    with pytest.raises(TokenOccupiedError):
        await repository.lock_tokens_with_block_hashes([("token-0", "hash-1")])


@pytest.mark.asyncio
async def test_resolve_targets_prefers_primary_and_includes_replica(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([("token-0", "hash-0")])
    resolved = await repository.get_resolve_targets("token-0")
    assert resolved is not None
    assert primary_url(resolved) == "http://a.test"
    assert len(resolved.targets) == 2
    assert resolved.targets[0].role == "primary"
    assert resolved.targets[1].role == "replica"
    assert resolved.targets[1].relay_base_url == "http://b.test"
