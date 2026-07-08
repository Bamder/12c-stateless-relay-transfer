from __future__ import annotations

import base64
from pathlib import Path

import pytest
import pytest_asyncio

from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.persistence.repository import RegistryRepository
from tests.registry_fixtures import DEFAULT_TEST_PLACEMENT_POLICY
from registry_server.scheduling.placement_ttl import effective_cap_seconds


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
        ),
        placement_policy=DEFAULT_TEST_PLACEMENT_POLICY,
        relay_heartbeat_stale_seconds=3600,
    )


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> RegistryRepository:
    repo = RegistryRepository(tmp_path / "registry.db", _test_config(tmp_path / "registry.db"))
    await repo.initialize()
    return repo


async def _seed_relay(
    repository: RegistryRepository,
    relay_id: str,
    *,
    block_max_age_seconds: int,
    block_sweep_interval_seconds: int = 3600,
    storage_rate: float = 0.1,
) -> None:
    await repository.upsert_relay_state(
        relay_id=relay_id,
        relay_base_url=f"http://{relay_id}.test",
        status="ok",
        stored_blocks=0,
        max_blocks=1000,
        storage_rate=storage_rate,
        block_max_age_seconds=block_max_age_seconds,
        block_sweep_interval_seconds=block_sweep_interval_seconds,
    )


@pytest.mark.asyncio
async def test_reserve_uses_requested_ttl_when_relays_satisfy(
    repository: RegistryRepository,
) -> None:
    await _seed_relay(repository, "relay-a", block_max_age_seconds=86400)
    await _seed_relay(repository, "relay-b", block_max_age_seconds=86400)

    outcome = await repository.lock_tokens_with_block_hashes(
        [("token-0", "hash-0")],
        ttl_seconds=7200,
    )

    assert outcome.granted_ttl_seconds == 7200
    assert outcome.degraded is False
    assert len(outcome.routes) == 1


@pytest.mark.asyncio
async def test_reserve_degrades_ttl_when_no_relay_meets_request(
    repository: RegistryRepository,
) -> None:
    short_cap = effective_cap_seconds(7200, clock_skew_seconds=60)
    await _seed_relay(repository, "relay-a", block_max_age_seconds=7200)
    await _seed_relay(repository, "relay-b", block_max_age_seconds=7200)
    await _seed_relay(repository, "relay-c", block_max_age_seconds=7200)

    outcome = await repository.lock_tokens_with_block_hashes(
        [("token-0", "hash-0")],
        ttl_seconds=7200,
    )

    assert outcome.granted_ttl_seconds == short_cap
    assert short_cap == 7140
    assert outcome.degraded is True


@pytest.mark.asyncio
async def test_effective_cap_only_subtracts_clock_skew() -> None:
    assert effective_cap_seconds(86400, clock_skew_seconds=60) == 86340
    assert effective_cap_seconds(7200, clock_skew_seconds=60) == 7140


@pytest.mark.asyncio
async def test_reserve_response_includes_placement_plan(
    repository: RegistryRepository,
) -> None:
    await _seed_relay(repository, "relay-a", block_max_age_seconds=86400)
    await _seed_relay(repository, "relay-b", block_max_age_seconds=86400)
    await _seed_relay(repository, "relay-c", block_max_age_seconds=86400)

    outcome = await repository.lock_tokens_with_block_hashes(
        [("token-0", "hash-0"), ("token-1", "hash-1")],
        ttl_seconds=3600,
    )

    assert outcome.ideal_relay_count >= 1
    assert outcome.actual_relay_count >= 1
    assert outcome.stripe_count >= 1
