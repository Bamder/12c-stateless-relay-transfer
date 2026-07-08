from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.config import RegistryServerConfig
from tests.registry_fixtures import DEFAULT_TEST_PLACEMENT_POLICY


def _empty_allowlist_config(database_path: Path) -> RegistryServerConfig:
    return RegistryServerConfig(
        host="127.0.0.1",
        port=8080,
        database_path=database_path,
        token_ttl_seconds=3600,
        registry_api_key_initial_uses=10,
        block_auth_master_key=base64.urlsafe_b64decode(
            base64.urlsafe_b64encode(b"0" * 32),
        ),
        allowlist=(),
        placement_policy=DEFAULT_TEST_PLACEMENT_POLICY,
        relay_heartbeat_stale_seconds=3600,
        admin_api_key="test-admin-key",
    )


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    config = _empty_allowlist_config(tmp_path / "registry.db")
    app = create_app(config)
    with TestClient(app) as test_client:
        yield test_client


def _admin_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-admin-key"}


def _registration_payload(
    install_id: str = "install-local-001",
    relay_base_url: str = "http://127.0.0.1:9091",
) -> dict[str, object]:
    return {
        "installId": install_id,
        "relayBaseUrl": relay_base_url,
        "relayPublicKeyPem": "dummy-public-key",
    }


def _heartbeat_payload(
    relay_id: str,
    relay_base_url: str = "http://127.0.0.1:9091",
) -> dict[str, object]:
    return {
        "relayId": relay_id,
        "relayBaseUrl": relay_base_url,
        "storedBlocks": 0,
        "maxBlocks": 100,
        "storageRate": 0.5,
        "relayPublicKeyPem": "dummy-public-key",
    }


def test_registration_request_creates_pending_queue_entry(client: TestClient) -> None:
    response = client.post(
        "/api/relay/registration-request",
        json=_registration_payload(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["installId"] == "install-local-001"
    assert payload["relayId"] is None

    list_response = client.get(
        "/api/admin/registration-requests?status=pending",
        headers=_admin_headers(),
    )
    assert list_response.status_code == 200
    body = list_response.json()
    assert body["pendingCount"] == 1
    assert len(body["requests"]) == 1
    assert body["requests"][0]["installId"] == "install-local-001"
    assert body["requests"][0].get("relayId") is None
    assert body["requests"][0]["relayBaseUrl"] == "http://127.0.0.1:9091"
    assert body["requests"][0]["hasPublicKey"] is True


def test_registration_status_unassigned_before_request(client: TestClient) -> None:
    response = client.get(
        "/api/relay/registration-status",
        params={"installId": "install-new"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "status": "unassigned",
        "installId": "install-new",
        "relayId": None,
    }


def test_heartbeat_without_allowlist_returns_403(client: TestClient) -> None:
    response = client.post(
        "/api/relay/heartbeat",
        json=_heartbeat_payload("relay-local"),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "relay not on allowlist"


def test_approve_registration_assigns_relay_id(client: TestClient) -> None:
    client.post("/api/relay/registration-request", json=_registration_payload())

    approve_response = client.post(
        "/api/admin/registration-requests/install-local-001/approve",
        headers=_admin_headers(),
        json={},
    )
    assert approve_response.status_code == 200
    body = approve_response.json()
    entry = body["entry"]
    assigned_relay_id = body["relayId"]
    assert assigned_relay_id.startswith("relay-")
    assert entry["relayId"] == assigned_relay_id
    assert entry["enabled"] is True

    status_response = client.get(
        "/api/relay/registration-status",
        params={"installId": "install-local-001"},
    )
    assert status_response.json()["status"] == "approved"
    assert status_response.json()["relayId"] == assigned_relay_id

    heartbeat_response = client.post(
        "/api/relay/heartbeat",
        json=_heartbeat_payload(assigned_relay_id),
    )
    assert heartbeat_response.status_code == 200


def test_ignore_then_reapply_returns_pending(client: TestClient) -> None:
    client.post("/api/relay/registration-request", json=_registration_payload())

    ignore_response = client.post(
        "/api/admin/registration-requests/install-local-001/ignore",
        headers=_admin_headers(),
    )
    assert ignore_response.status_code == 200

    status_response = client.get(
        "/api/relay/registration-status",
        params={"installId": "install-local-001"},
    )
    assert status_response.json()["status"] == "ignored"

    pending_response = client.get(
        "/api/admin/registration-requests?status=pending",
        headers=_admin_headers(),
    )
    assert pending_response.json()["pendingCount"] == 0

    reapply_response = client.post(
        "/api/relay/registration-request",
        json=_registration_payload(relay_base_url="http://127.0.0.1:9092"),
    )
    assert reapply_response.status_code == 200
    assert reapply_response.json()["status"] == "pending"

    list_response = client.get(
        "/api/admin/registration-requests?status=pending",
        headers=_admin_headers(),
    )
    assert list_response.json()["pendingCount"] == 1
    assert list_response.json()["requests"][0]["relayBaseUrl"] == "http://127.0.0.1:9092"


def test_reapply_after_approval_resets_to_pending(client: TestClient) -> None:
    client.post("/api/relay/registration-request", json=_registration_payload())
    approve_response = client.post(
        "/api/admin/registration-requests/install-local-001/approve",
        headers=_admin_headers(),
        json={},
    )
    first_relay_id = approve_response.json()["relayId"]

    client.delete(
        f"/api/admin/allowlist/{first_relay_id}",
        headers=_admin_headers(),
    )

    reapply_response = client.post(
        "/api/relay/registration-request",
        json=_registration_payload(relay_base_url="http://127.0.0.1:9092"),
    )
    assert reapply_response.status_code == 200
    assert reapply_response.json()["status"] == "pending"

    list_response = client.get(
        "/api/admin/registration-requests?status=pending",
        headers=_admin_headers(),
    )
    assert list_response.json()["pendingCount"] == 1
    assert list_response.json()["requests"][0].get("relayId") is None

    second_approve = client.post(
        "/api/admin/registration-requests/install-local-001/approve",
        headers=_admin_headers(),
        json={},
    )
    assert second_approve.status_code == 200
    second_relay_id = second_approve.json()["relayId"]
    assert second_relay_id != first_relay_id

    status_response = client.get(
        "/api/relay/registration-status",
        params={"installId": "install-local-001"},
    )
    assert status_response.json()["status"] == "approved"
    assert status_response.json()["relayId"] == second_relay_id


def test_delete_admin_db_row_removes_registration_request(client: TestClient) -> None:
    client.post(
        "/api/relay/registration-request",
        json=_registration_payload(install_id="install-delete-me"),
    )
    delete_response = client.post(
        "/api/admin/db/rows/delete",
        headers=_admin_headers(),
        json={
            "table": "relay_registration_requests",
            "keys": {"install_id": "install-delete-me"},
        },
    )
    assert delete_response.status_code == 200

    list_response = client.get(
        "/api/admin/registration-requests?status=pending",
        headers=_admin_headers(),
    )
    assert list_response.json()["pendingCount"] == 0
