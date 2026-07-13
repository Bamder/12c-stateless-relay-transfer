from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.scheduling.policy import PlacementPolicy

TOKEN_PRESENT = "a" * 64
TOKEN_MISSING = "b" * 64
BLOCK_HASH = "c" * 64


def _config(database_path: Path) -> RegistryServerConfig:
    return RegistryServerConfig(
        host="127.0.0.1",
        port=8080,
        database_path=database_path,
        token_ttl_seconds=3600,
        registry_api_key_initial_uses=10,
        block_auth_master_key=base64.urlsafe_b64decode(
            base64.urlsafe_b64encode(b"0" * 32),
        ),
        allowlist=(AllowlistEntry("relay-a", "http://relay-a.test"),),
        placement_policy=PlacementPolicy(
            stripe_target_relays=1,
            max_file_replica_count=0,
            max_replicas_per_block=0,
        ),
        relay_heartbeat_stale_seconds=3600,
    )


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    app = create_app(_config(tmp_path / "registry.db"))
    with TestClient(app) as test_client:
        yield test_client


def _reserve_token(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/relay/reserve-tokens",
        json={"blocks": [{"token": token, "blockHash": BLOCK_HASH}]},
    )
    assert response.status_code == 200


def test_resolve_returns_empty_targets_for_missing_tokens(client: TestClient) -> None:
    _reserve_token(client, TOKEN_PRESENT)

    response = client.post(
        "/api/relay/resolve",
        json={"tokens": [TOKEN_PRESENT, TOKEN_MISSING]},
    )
    assert response.status_code == 200
    payload = response.json()
    routes = {item["token"]: item for item in payload["routes"]}
    assert len(routes) == 2

    present = routes[TOKEN_PRESENT]
    assert len(present["targets"]) == 1
    assert present["targets"][0]["role"] == "primary"
    assert present["targets"][0]["relayBaseUrl"] == "http://relay-a.test"

    missing = routes[TOKEN_MISSING]
    assert missing["targets"] == []
    assert missing.get("resolveStatus") == "unavailable"


def test_resolve_marks_expired_tokens(client: TestClient, tmp_path: Path) -> None:
    import sqlite3

    _reserve_token(client, TOKEN_PRESENT)
    db_path = tmp_path / "registry.db"
    with sqlite3.connect(db_path) as db:
        db.execute(
            "UPDATE token_relay_placements SET expiry_at = '2000-01-01T00:00:00+00:00'",
        )
        db.commit()

    response = client.post(
        "/api/relay/resolve",
        json={"tokens": [TOKEN_PRESENT]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["routes"] == [
        {"token": TOKEN_PRESENT, "targets": [], "resolveStatus": "expired"},
    ]


def test_resolve_all_missing_returns_empty_targets_without_error(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/relay/resolve",
        json={"tokens": [TOKEN_MISSING]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["routes"] == [
        {"token": TOKEN_MISSING, "targets": [], "resolveStatus": "unavailable"},
    ]
