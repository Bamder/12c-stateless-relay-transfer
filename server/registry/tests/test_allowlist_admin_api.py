from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.config import AllowlistEntry, RegistryServerConfig


def _test_config(database_path: Path, *, admin_api_key: str | None = "test-admin-key") -> RegistryServerConfig:
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
        ),
        stripe_target_relays=3,
        max_file_replica_count=1,
        max_replicas_per_block=2,
        relay_heartbeat_stale_seconds=3600,
        admin_api_key=admin_api_key,
    )


@pytest.fixture
def admin_client(tmp_path: Path) -> TestClient:
    config = _test_config(tmp_path / "registry.db")
    app = create_app(config)
    with TestClient(app) as client:
        yield client


def _admin_headers(key: str = "test-admin-key") -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def test_list_allowlist_requires_admin_key(admin_client: TestClient) -> None:
    response = admin_client.get("/api/admin/allowlist")
    assert response.status_code == 401

    response = admin_client.get("/api/admin/allowlist", headers=_admin_headers())
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["entries"]) == 2
    assert {entry["relayId"] for entry in payload["entries"]} == {"relay-a", "relay-b"}


def test_add_and_patch_allowlist_entry(admin_client: TestClient) -> None:
    add_response = admin_client.post(
        "/api/admin/allowlist",
        headers=_admin_headers(),
        json={"relayId": "relay-c", "relayBaseUrl": "http://c.test/"},
    )
    assert add_response.status_code == 200
    entry = add_response.json()["entry"]
    assert entry["relayId"] == "relay-c"
    assert entry["relayBaseUrl"] == "http://c.test"
    assert entry["enabled"] is True

    disable_response = admin_client.patch(
        "/api/admin/allowlist/relay-c",
        headers=_admin_headers(),
        json={"enabled": False},
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["entry"]["enabled"] is False

    enable_response = admin_client.patch(
        "/api/admin/allowlist/relay-c",
        headers=_admin_headers(),
        json={"enabled": True, "relayBaseUrl": "http://c-new.test"},
    )
    assert enable_response.status_code == 200
    updated = enable_response.json()["entry"]
    assert updated["enabled"] is True
    assert updated["relayBaseUrl"] == "http://c-new.test"

    list_response = admin_client.get("/api/admin/allowlist", headers=_admin_headers())
    relay_c = next(
        item for item in list_response.json()["entries"] if item["relayId"] == "relay-c"
    )
    assert relay_c["relayBaseUrl"] == "http://c-new.test"


def test_re_add_disabled_relay_re_enables(admin_client: TestClient) -> None:
    admin_client.post(
        "/api/admin/allowlist",
        headers=_admin_headers(),
        json={"relayId": "relay-x", "relayBaseUrl": "http://x.test"},
    )
    admin_client.patch(
        "/api/admin/allowlist/relay-x",
        headers=_admin_headers(),
        json={"enabled": False},
    )

    readd_response = admin_client.post(
        "/api/admin/allowlist",
        headers=_admin_headers(),
        json={"relayId": "relay-x", "relayBaseUrl": "http://x2.test"},
    )
    assert readd_response.status_code == 200
    entry = readd_response.json()["entry"]
    assert entry["enabled"] is True
    assert entry["relayBaseUrl"] == "http://x2.test"


def test_patch_missing_allowlist_entry_returns_404(admin_client: TestClient) -> None:
    response = admin_client.patch(
        "/api/admin/allowlist/missing-relay",
        headers=_admin_headers(),
        json={"enabled": False},
    )
    assert response.status_code == 404


def test_admin_api_disabled_when_not_configured(tmp_path: Path) -> None:
    config = _test_config(tmp_path / "registry.db", admin_api_key=None)
    app = create_app(config)
    with TestClient(app) as client:
        response = client.get(
            "/api/admin/allowlist",
            headers=_admin_headers(),
        )
        assert response.status_code == 503


def test_disabled_relay_not_allowlisted_for_heartbeat(admin_client: TestClient) -> None:
    admin_client.post(
        "/api/admin/allowlist",
        headers=_admin_headers(),
        json={"relayId": "relay-off", "relayBaseUrl": "http://off.test"},
    )
    admin_client.patch(
        "/api/admin/allowlist/relay-off",
        headers=_admin_headers(),
        json={"enabled": False},
    )

    heartbeat_response = admin_client.post(
        "/api/relay/heartbeat",
        json={
            "relayId": "relay-off",
            "relayBaseUrl": "http://off.test",
            "storedBlocks": 0,
            "maxBlocks": 100,
            "storageRate": 0.5,
            "relayPublicKeyPem": "dummy",
        },
    )
    assert heartbeat_response.status_code == 403


def test_admin_key_via_header_alias(admin_client: TestClient) -> None:
    response = admin_client.get(
        "/api/admin/allowlist",
        headers={"X-Registry-Admin-Key": "test-admin-key"},
    )
    assert response.status_code == 200


def test_delete_allowlist_entry(admin_client: TestClient) -> None:
    admin_client.post(
        "/api/admin/allowlist",
        headers=_admin_headers(),
        json={"relayId": "relay-del", "relayBaseUrl": "http://del.test"},
    )

    delete_response = admin_client.delete(
        "/api/admin/allowlist/relay-del",
        headers=_admin_headers(),
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["relayId"] == "relay-del"

    list_response = admin_client.get("/api/admin/allowlist", headers=_admin_headers())
    relay_ids = {entry["relayId"] for entry in list_response.json()["entries"]}
    assert "relay-del" not in relay_ids

    db = admin_client.get("/api/admin/db", headers=_admin_headers())
    allowlist_rows = db.json()["tables"]["registry_allowlist"]["rows"]
    assert all(row["relay_id"] != "relay-del" for row in allowlist_rows)


def test_delete_missing_allowlist_entry_returns_404(admin_client: TestClient) -> None:
    response = admin_client.delete(
        "/api/admin/allowlist/missing-relay",
        headers=_admin_headers(),
    )
    assert response.status_code == 404


def test_relay_overview_and_db_admin(admin_client: TestClient) -> None:
    overview = admin_client.get(
        "/api/admin/relays/overview",
        headers=_admin_headers(),
    )
    assert overview.status_code == 200
    relays = overview.json()["relays"]
    assert len(relays) >= 2
    assert all("healthStatus" in item for item in relays)

    db = admin_client.get("/api/admin/db", headers=_admin_headers())
    assert db.status_code == 200
    tables = db.json()["tables"]
    assert "registry_allowlist" in tables
    assert "relay_states" in tables
