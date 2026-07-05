from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.config import (
    HEARTBEAT_URL_POLICY_STRICT,
    HEARTBEAT_URL_POLICY_SYNC_IF_UNSET,
    AllowlistEntry,
    RegistryServerConfig,
)


def _test_config(
    database_path: Path,
    *,
    allowlist: tuple[AllowlistEntry, ...],
    heartbeat_url_policy: str = HEARTBEAT_URL_POLICY_SYNC_IF_UNSET,
    admin_api_key: str | None = "test-admin-key",
) -> RegistryServerConfig:
    return RegistryServerConfig(
        host="127.0.0.1",
        port=8080,
        database_path=database_path,
        token_ttl_seconds=3600,
        registry_api_key_initial_uses=10,
        block_auth_master_key=base64.urlsafe_b64decode(
            base64.urlsafe_b64encode(b"0" * 32),
        ),
        allowlist=allowlist,
        stripe_target_relays=3,
        max_file_replica_count=1,
        max_replicas_per_block=2,
        relay_heartbeat_stale_seconds=3600,
        admin_api_key=admin_api_key,
        heartbeat_url_policy=heartbeat_url_policy,
    )


@pytest.fixture
def sync_client(tmp_path: Path) -> TestClient:
    config = _test_config(
        tmp_path / "registry.db",
        allowlist=(AllowlistEntry("relay-a", "http://a.test"),),
    )
    app = create_app(config)
    with TestClient(app) as client:
        yield client


def _heartbeat_payload(relay_id: str, relay_base_url: str) -> dict[str, object]:
    return {
        "relayId": relay_id,
        "relayBaseUrl": relay_base_url,
        "storedBlocks": 0,
        "maxBlocks": 100,
        "storageRate": 0.5,
        "relayPublicKeyPem": "dummy",
    }


def test_heartbeat_accepts_matching_allowlist_url(sync_client: TestClient) -> None:
    response = sync_client.post(
        "/api/relay/heartbeat",
        json=_heartbeat_payload("relay-a", "http://a.test"),
    )
    assert response.status_code == 200


def test_heartbeat_rejects_mismatched_url(sync_client: TestClient) -> None:
    response = sync_client.post(
        "/api/relay/heartbeat",
        json=_heartbeat_payload("relay-a", "http://wrong.test"),
    )
    assert response.status_code == 409
    assert "relayBaseUrl mismatch" in response.json()["detail"]


def test_sync_if_unset_adopts_heartbeat_url(tmp_path: Path) -> None:
    config = _test_config(
        tmp_path / "registry.db",
        allowlist=(AllowlistEntry("relay-new"),),
    )
    app = create_app(config)
    with TestClient(app) as client:
        response = client.post(
            "/api/relay/heartbeat",
            json=_heartbeat_payload("relay-new", "http://new.test"),
        )
        assert response.status_code == 200

        list_response = client.get(
            "/api/admin/allowlist",
            headers={"Authorization": "Bearer test-admin-key"},
        )
        assert list_response.status_code == 200
        entry = next(
            item for item in list_response.json()["entries"] if item["relayId"] == "relay-new"
        )
        assert entry["relayBaseUrl"] == "http://new.test"


def test_strict_rejects_unset_allowlist_url(tmp_path: Path) -> None:
    config = _test_config(
        tmp_path / "registry.db",
        allowlist=(AllowlistEntry("relay-new"),),
        heartbeat_url_policy=HEARTBEAT_URL_POLICY_STRICT,
    )
    app = create_app(config)
    with TestClient(app) as client:
        response = client.post(
            "/api/relay/heartbeat",
            json=_heartbeat_payload("relay-new", "http://new.test"),
        )
        assert response.status_code == 409
        assert "not configured in allowlist" in response.json()["detail"]


def test_heartbeat_normalizes_trailing_slash(sync_client: TestClient) -> None:
    response = sync_client.post(
        "/api/relay/heartbeat",
        json=_heartbeat_payload("relay-a", "http://a.test/"),
    )
    assert response.status_code == 200
