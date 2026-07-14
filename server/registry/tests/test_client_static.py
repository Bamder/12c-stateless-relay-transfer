from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from registry_server.api.app import create_app
from registry_server.api.client_static import _safe_public_prefix
from registry_server.config import AllowlistEntry, RegistryServerConfig
from registry_server.scheduling.policy import PlacementPolicy


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("/services/registry/", "/services/registry"),
        ("", ""),
        ("//attacker.example", ""),
        ("/safe/../attacker", ""),
        ("/safe%3Fredirect=attacker", ""),
    ],
)
def test_safe_public_prefix(value: str, expected: str) -> None:
    assert _safe_public_prefix(value) == expected


def _config(database_path: Path, *, client_static_dir: Path | None = None) -> RegistryServerConfig:
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
        client_static_dir=client_static_dir,
    )


def test_health_reports_client_dist_ready(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir()
    (dist_dir / "index.html").write_text("<!doctype html><title>client</title>", encoding="utf-8")

    app = create_app(_config(tmp_path / "registry.db", client_static_dir=dist_dir))
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["clientDistReady"] is True


def test_serves_client_index_and_same_origin_relay_config(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir()
    (dist_dir / "index.html").write_text("<!doctype html><title>client</title>", encoding="utf-8")
    (dist_dir / "relay.config.json").write_text('{"registry":{"url":"http://ignored"}}', encoding="utf-8")

    app = create_app(_config(tmp_path / "registry.db", client_static_dir=dist_dir))
    with TestClient(app) as client:
        index = client.get("/")
        config = client.get(
            "/relay.config.json",
            headers={
                "x-forwarded-proto": "https",
                "x-forwarded-host": "registry.example.com",
                "x-forwarded-prefix": "/services/registry/",
            },
        )
        config_without_prefix = client.get(
            "/relay.config.json",
            headers={
                "x-forwarded-proto": "https",
                "x-forwarded-host": "registry.example.com",
            },
        )
        api = client.post("/api/relay/resolve", json={"tokens": ["b" * 64]})

    assert index.status_code == 200
    assert "client" in index.text
    assert config.status_code == 200
    assert config.json() == {
        "registry": {"url": "https://registry.example.com/services/registry"},
        "relay": {"maxBodyBytes": 32 * 1024 * 1024},
    }
    assert config_without_prefix.json()["registry"] == {
        "url": "https://registry.example.com",
    }
    assert api.status_code == 200


def test_missing_client_dist_shows_build_hint(tmp_path: Path) -> None:
    missing_dir = tmp_path / "missing-dist"
    app = create_app(_config(tmp_path / "registry.db", client_static_dir=missing_dir))
    with TestClient(app) as client:
        response = client.get("/")
    assert response.status_code == 503
    assert "尚未构建" in response.text
