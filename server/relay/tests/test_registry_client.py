from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi import FastAPI
from httpx import ASGITransport

from relay_server.identity import RelayIdentityManager
from relay_server.registry.api_key_manager import RegistryApiKeyManager
from relay_server.registry.block_auth_key_manager import BlockAuthKeyManager
from relay_server.registry.client import RegistryClient, _create_registry_http_client


def _build_client(tmp_path: Path) -> RegistryClient:
    secrets_dir = tmp_path / "secrets"
    secrets_dir.mkdir()
    identity = RelayIdentityManager(secrets_dir)
    identity.load()
    return RegistryClient(
        base_url="http://127.0.0.1:8080",
        identity=identity,
        relay_base_url="http://127.0.0.1:9090",
        registry_api_keys=RegistryApiKeyManager(
            relay_rsa_key_path=secrets_dir / "relay_rsa.pem",
            registry_api_key_store_path=secrets_dir / "registry_api_key.json",
        ),
        block_auth_keys=BlockAuthKeyManager(
            relay_rsa_key_path=secrets_dir / "relay_rsa.pem",
            block_auth_key_store_path=secrets_dir / "block_auth_key.json",
        ),
    )


class RegistryClientProxyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.registry_client = _build_client(Path(self.temp_dir.name))

    async def asyncTearDown(self) -> None:
        await self.registry_client.close()
        self.temp_dir.cleanup()

    def test_create_registry_http_client_disables_env_proxy(self) -> None:
        client = _create_registry_http_client("http://127.0.0.1:8080")
        try:
            self.assertFalse(client.trust_env)
        finally:
            asyncio.run(client.aclose())

    def test_create_registry_http_client_uses_explicit_proxy(self) -> None:
        client = _create_registry_http_client(
            "https://registry.example.com",
            http_proxy="http://corp-proxy:8080",
        )
        try:
            self.assertFalse(client.trust_env)
            self.assertEqual(len(client._mounts), 1)
            transport = next(iter(client._mounts.values()))
            self.assertIsNotNone(transport)
        finally:
            asyncio.run(client.aclose())

    async def test_submit_registration_ignores_http_proxy_env(self) -> None:
        previous_http_proxy = os.environ.get("HTTP_PROXY")
        previous_https_proxy = os.environ.get("HTTPS_PROXY")
        previous_no_proxy = os.environ.get("NO_PROXY")
        os.environ["HTTP_PROXY"] = "http://127.0.0.1:1"
        os.environ["HTTPS_PROXY"] = "http://127.0.0.1:1"
        os.environ.pop("NO_PROXY", None)
        try:
            app = FastAPI()

            @app.post("/api/relay/registration-request")
            async def registration_request(body: dict[str, object]) -> dict[str, object]:
                return {
                    "status": "pending",
                    "installId": body["installId"],
                    "relayId": None,
                }

            transport = ASGITransport(app=app)
            self.registry_client._client = httpx.AsyncClient(
                transport=transport,
                base_url="http://registry.test",
                trust_env=False,
            )

            result = await self.registry_client.submit_registration_request()
            self.assertEqual(result["status"], "pending")
            self.assertEqual(result["installId"], self.registry_client._identity.install_id)
        finally:
            if previous_http_proxy is None:
                os.environ.pop("HTTP_PROXY", None)
            else:
                os.environ["HTTP_PROXY"] = previous_http_proxy
            if previous_https_proxy is None:
                os.environ.pop("HTTPS_PROXY", None)
            else:
                os.environ["HTTPS_PROXY"] = previous_https_proxy
            if previous_no_proxy is None:
                os.environ.pop("NO_PROXY", None)
            else:
                os.environ["NO_PROXY"] = previous_no_proxy

    async def test_report_heartbeat_without_assignment_skips_request(self) -> None:
        app = FastAPI()

        @app.post("/api/relay/heartbeat")
        async def heartbeat(_: dict[str, object]) -> dict[str, object]:
            raise AssertionError("heartbeat should not be called before assignment")

        transport = ASGITransport(app=app)
        self.registry_client._client = httpx.AsyncClient(
            transport=transport,
            base_url="http://registry.test",
            trust_env=False,
        )

        result = await self.registry_client.report_heartbeat(
            stored_blocks=0,
            max_blocks=1,
            storage_rate=0.0,
            block_max_age_seconds=86400,
            block_sweep_interval_seconds=3600,
        )
        self.assertEqual(result, {"notAssigned": True})

    async def test_submit_registration_clears_existing_assignment(self) -> None:
        identity = self.registry_client._identity
        identity.assign_relay_id("relay-old")
        secrets_dir = Path(self.temp_dir.name) / "secrets"
        assigned_path = secrets_dir / "assigned_relay_id.json"
        self.assertTrue(assigned_path.is_file())

        app = FastAPI()

        @app.post("/api/relay/registration-request")
        async def registration_request(_: dict[str, object]) -> dict[str, object]:
            return {
                "status": "pending",
                "installId": identity.install_id,
                "relayId": None,
            }

        transport = ASGITransport(app=app)
        self.registry_client._client = httpx.AsyncClient(
            transport=transport,
            base_url="http://registry.test",
            trust_env=False,
        )

        result = await self.registry_client.submit_registration_request()
        self.assertEqual(result["status"], "pending")
        self.assertIsNone(identity.relay_id)
        self.assertFalse(assigned_path.is_file())

    async def test_submit_registration_restores_already_allowlisted_relay_id(self) -> None:
        identity = self.registry_client._identity
        identity.assign_relay_id("relay-old")

        app = FastAPI()

        @app.post("/api/relay/registration-request")
        async def registration_request(_: dict[str, object]) -> dict[str, object]:
            return {
                "status": "already_allowlisted",
                "installId": identity.install_id,
                "relayId": "relay-allowlisted",
            }

        transport = ASGITransport(app=app)
        self.registry_client._client = httpx.AsyncClient(
            transport=transport,
            base_url="http://registry.test",
            trust_env=False,
        )

        result = await self.registry_client.submit_registration_request()
        self.assertEqual(result["status"], "already_allowlisted")
        self.assertEqual(identity.relay_id, "relay-allowlisted")


if __name__ == "__main__":
    unittest.main()
