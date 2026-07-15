from __future__ import annotations

import base64
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.persistence.repository import RegistryRepository
from registry_server.scheduling.policy import PlacementPolicy
from registry_server.services.registry import RegistryService
from fastapi import HTTPException

TOKEN = "a" * 64
BLOCK_HASH = "c" * 64
ADMIN_KEY = "test-admin-key"


def _single_relay_config(database_path: Path) -> RegistryServerConfig:
    return RegistryServerConfig(
        host="127.0.0.1",
        port=8080,
        database_path=database_path,
        token_ttl_seconds=3600,
        registry_api_key_initial_uses=10,
        block_auth_master_key=base64.urlsafe_b64decode(
            base64.urlsafe_b64encode(b"0" * 32),
        ),
        allowlist=(AllowlistEntry("relay-a", "http://old-tunnel.test"),),
        placement_policy=PlacementPolicy(
            stripe_target_relays=1,
            max_file_replica_count=0,
            max_replicas_per_block=0,
        ),
        relay_heartbeat_stale_seconds=3600,
        admin_api_key=ADMIN_KEY,
    )


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    app = create_app(_single_relay_config(tmp_path / "registry.db"))
    with TestClient(app) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> RegistryRepository:
    db_path = tmp_path / "registry.db"
    config = _single_relay_config(db_path)
    repo = RegistryRepository(db_path, config)
    await repo.initialize()
    await repo.upsert_relay_state(
        relay_id="relay-a",
        relay_base_url="http://old-tunnel.test",
        status="ok",
        stored_blocks=0,
        max_blocks=1000,
        storage_rate=0.1,
    )
    return repo


@pytest.mark.asyncio
async def test_canonical_url_prefers_allowlist_over_state(
    repository: RegistryRepository,
) -> None:
    await repository.patch_allowlist_entry(
        "relay-a",
        relay_base_url="http://new-tunnel.test",
    )
    await repository.upsert_relay_state(
        relay_id="relay-a",
        relay_base_url="http://old-tunnel.test",
        status="ok",
        stored_blocks=0,
        max_blocks=1000,
        storage_rate=0.1,
    )
    assert (
        await repository.get_canonical_relay_base_url("relay-a")
        == "http://new-tunnel.test"
    )


@pytest.mark.asyncio
async def test_resolve_uses_live_allowlist_url_after_public_url_change(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([(TOKEN, BLOCK_HASH)])
    before = await repository.get_resolve_targets(TOKEN)
    assert before is not None
    assert before.targets[0].relay_base_url == "http://old-tunnel.test"

    await repository.patch_allowlist_entry(
        "relay-a",
        relay_base_url="http://new-tunnel.test",
    )
    placements = await repository.get_token_placements(TOKEN)
    assert placements[0].registered_relay_base_url == "http://old-tunnel.test"

    after = await repository.get_resolve_targets(TOKEN)
    assert after is not None
    assert after.targets[0].relay_id == "relay-a"
    assert after.targets[0].relay_base_url == "http://new-tunnel.test"


@pytest.mark.asyncio
async def test_validate_placement_accepts_new_url_after_allowlist_change(
    repository: RegistryRepository,
) -> None:
    await repository.lock_tokens_with_block_hashes([(TOKEN, BLOCK_HASH)])
    service = RegistryService(repository)

    await repository.patch_allowlist_entry(
        "relay-a",
        relay_base_url="http://new-tunnel.test",
    )

    # Old snapshot URL alone must not authorize; live canonical must.
    with pytest.raises(HTTPException) as rejected:
        await service._validate_relay_placement(
            token=TOKEN,
            relay_id="relay-a",
            relay_base_url="http://old-tunnel.test",
            block_hash=BLOCK_HASH,
        )
    assert rejected.value.status_code == 403

    placement = await service._validate_relay_placement(
        token=TOKEN,
        relay_id="relay-a",
        relay_base_url="http://new-tunnel.test",
        block_hash=BLOCK_HASH,
    )
    assert placement.relay_id == "relay-a"


def test_http_resolve_follows_allowlist_patch(client: TestClient) -> None:
    reserve = client.post(
        "/api/relay/reserve-tokens",
        json={"blocks": [{"token": TOKEN, "blockHash": BLOCK_HASH}]},
    )
    assert reserve.status_code == 200
    assert (
        reserve.json()["routes"][0]["targets"][0]["relayBaseUrl"]
        == "http://old-tunnel.test"
    )

    patched = client.patch(
        "/api/admin/allowlist/relay-a",
        headers={"Authorization": f"Bearer {ADMIN_KEY}"},
        json={"relayBaseUrl": "http://new-tunnel.test"},
    )
    assert patched.status_code == 200

    resolved = client.post(
        "/api/relay/resolve",
        json={"tokens": [TOKEN]},
    )
    assert resolved.status_code == 200
    route = resolved.json()["routes"][0]
    assert route["targets"][0]["relayBaseUrl"] == "http://new-tunnel.test"
