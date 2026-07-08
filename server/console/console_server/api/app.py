from __future__ import annotations

import asyncio
import json

from contextlib import asynccontextmanager

from typing import AsyncIterator



from fastapi import FastAPI, HTTPException, Request

from fastapi.responses import FileResponse

from fastapi.staticfiles import StaticFiles



from ..config import ConsoleServerConfig, load_config
from ..db_admin import (
    REGISTRY_DB_PRIMARY_KEYS,
    RELAY_DB_PRIMARY_KEYS,
    delete_sqlite_row,
    enrich_admin_db_payload,
    is_missing_upstream_route,
    resolve_database_path,
)
from ..relay_config import (
    read_relay_public_base_url,
    read_relay_registry_url,
    write_relay_public_base_url,
    write_relay_registry_url,
)
from ..runtime.process_manager import ProcessManager, ServiceLaunchConfig

from .proxy import UpstreamClient, passthrough_response, proxy_json, upstream_error_detail


async def _parse_detached_start(request: Request) -> bool:
    if not request.headers.get("content-type", "").startswith("application/json"):
        return False
    try:
        body = await request.json()
    except Exception:
        return False
    if not isinstance(body, dict):
        return False
    return body.get("detached") is True


def create_app(config: ConsoleServerConfig | None = None) -> FastAPI:

    settings = config or load_config()

    upstream = UpstreamClient(

        registry_base_url=settings.registry_base_url,

        relay_base_url=settings.relay_base_url,

        registry_admin_api_key=settings.registry_admin_api_key,

        relay_admin_api_key=settings.relay_admin_api_key,

    )

    launcher = ProcessManager(

        ServiceLaunchConfig(

            registry_dir=settings.registry_dir,

            relay_dir=settings.relay_dir,

            registry_config=settings.registry_config_path,

            relay_config=settings.relay_config_path,

            registry_health_url=f"{settings.registry_base_url}/health",

            relay_health_url=f"{settings.relay_base_url}/health",

            registry_admin_api_key=settings.registry_admin_api_key,

            relay_admin_api_key=settings.relay_admin_api_key,

            python_executable=settings.python_executable,

        ),

    )



    @asynccontextmanager

    async def lifespan(_: FastAPI) -> AsyncIterator[None]:

        yield

        await launcher.close()

        await upstream.close()



    app = FastAPI(title="12C Control Console", lifespan=lifespan)

    static_dir = settings.static_dir

    if static_dir.is_dir():

        app.mount("/assets", StaticFiles(directory=str(static_dir)), name="assets")



    @app.get("/")

    async def index() -> FileResponse:

        index_path = static_dir / "index.html"

        if not index_path.is_file():

            raise RuntimeError(f"console static index not found: {index_path}")

        return FileResponse(index_path)



    @app.get("/api/services/status")

    async def services_status() -> object:

        return await launcher.status()

    @app.get("/api/config/local-relay")
    async def local_relay_config() -> object:
        path = settings.relay_config_path
        if not path.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"relay config not found: {path}",
            )
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise HTTPException(status_code=500, detail="relay config must be a JSON object")
        port = data.get("port", 9090)
        if isinstance(port, bool) or not isinstance(port, int):
            port = 9090
        base_url = data.get("publicBaseUrl")
        if not isinstance(base_url, str) or not base_url:
            base_url = f"http://127.0.0.1:{port}"
        return {
            "relayId": "relay-local",
            "relayBaseUrl": base_url.rstrip("/"),
        }

    @app.get("/api/config/local-registry")
    async def local_registry_config() -> object:
        return {"registryUrl": settings.registry_base_url}

    @app.get("/api/config/relay-registry")
    async def relay_registry_config() -> object:
        configured = read_relay_registry_url(settings.relay_config_path)
        return {
            "registryUrl": configured or settings.registry_base_url,
            "configuredInRelayConfig": configured is not None,
        }

    @app.put("/api/config/relay-registry")
    async def update_relay_registry_config(request: Request) -> object:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="request body must be a JSON object")
        registry_url = body.get("registryUrl")
        if not isinstance(registry_url, str) or not registry_url.strip():
            raise HTTPException(status_code=400, detail="registryUrl must be a non-empty string")
        saved = write_relay_registry_url(settings.relay_config_path, registry_url)
        return {"registryUrl": saved}

    @app.get("/api/config/relay-public-url")
    async def relay_public_url_config() -> object:
        public_base_url, port = read_relay_public_base_url(settings.relay_config_path)
        return {
            "publicBaseUrl": public_base_url,
            "localListenUrl": f"http://127.0.0.1:{port}",
        }

    @app.put("/api/config/relay-public-url")
    async def update_relay_public_url_config(request: Request) -> object:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="request body must be a JSON object")
        public_base_url = body.get("publicBaseUrl")
        if not isinstance(public_base_url, str) or not public_base_url.strip():
            raise HTTPException(status_code=400, detail="publicBaseUrl must be a non-empty string")
        saved = write_relay_public_base_url(settings.relay_config_path, public_base_url)

        allowlist_synced = False
        relay_id = body.get("relayId")
        if isinstance(relay_id, str) and relay_id.strip():
            try:
                response = await upstream.registry_admin(
                    "PATCH",
                    f"/api/admin/allowlist/{relay_id.strip()}",
                    json_body={"relayBaseUrl": saved},
                )
                allowlist_synced = response.is_success
            except HTTPException:
                pass

        return {
            "publicBaseUrl": saved,
            "allowlistSynced": allowlist_synced,
        }


    @app.post("/api/services/registry/start")
    async def start_registry_service(request: Request) -> object:
        try:
            detached = await _parse_detached_start(request)
            return await launcher.start("registry", detached=detached)
        except (FileNotFoundError, RuntimeError) as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.post("/api/services/registry/stop")
    async def stop_registry_service() -> object:
        try:
            return await launcher.stop("registry")
        except RuntimeError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.post("/api/services/relay/start")
    async def start_relay_service(request: Request) -> object:
        try:
            detached = await _parse_detached_start(request)
            return await launcher.start("relay", detached=detached)
        except (FileNotFoundError, RuntimeError) as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.post("/api/services/relay/stop")
    async def stop_relay_service() -> object:
        try:
            return await launcher.stop("relay")
        except RuntimeError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error



    @app.get("/api/registry/relays/overview")

    async def registry_relays_overview() -> object:

        response = await upstream.registry_admin("GET", "/api/admin/relays/overview")

        return await passthrough_response(response)



    @app.get("/api/registry/db")
    async def registry_db() -> object:
        response = await upstream.registry_admin("GET", "/api/admin/db")
        if response.status_code >= 400:
            return await passthrough_response(response)
        payload = response.json()
        if isinstance(payload, dict):
            enrich_admin_db_payload(payload, REGISTRY_DB_PRIMARY_KEYS)
            return payload
        return await passthrough_response(response)

    @app.post("/api/registry/db/rows/delete")
    async def registry_delete_db_row(request: Request) -> object:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        table = body.get("table")
        keys = body.get("keys")
        if not isinstance(table, str) or not isinstance(keys, dict):
            raise HTTPException(status_code=400, detail="table and keys are required")

        response = await upstream.registry_admin(
            "POST",
            "/api/admin/db/rows/delete",
            json_body=body,
        )
        if response.status_code < 400:
            return await passthrough_response(response)
        if response.status_code == 404:
            try:
                payload = response.json()
                detail = payload.get("detail") if isinstance(payload, dict) else None
            except Exception:
                detail = None
            if not is_missing_upstream_route(detail):
                return await passthrough_response(response)
        elif response.status_code != 502:
            return await passthrough_response(response)

        db_path = resolve_database_path(settings.registry_config_path)
        try:
            deleted = await asyncio.to_thread(
                delete_sqlite_row,
                db_path,
                table=table,
                keys=keys,
                primary_keys=REGISTRY_DB_PRIMARY_KEYS,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not deleted:
            raise HTTPException(status_code=404, detail="row not found")
        return {"result": "deleted", "table": table, "keys": keys}

    @app.get("/api/registry/registration-requests")
    async def registry_registration_requests() -> object:
        response = await upstream.registry_admin(
            "GET",
            "/api/admin/registration-requests?status=pending",
        )
        return await passthrough_response(response)

    @app.post("/api/registry/registration-requests/{install_id}/approve")
    async def registry_approve_registration(install_id: str) -> object:
        response = await upstream.registry_admin(
            "POST",
            f"/api/admin/registration-requests/{install_id}/approve",
            json_body={},
        )
        return await passthrough_response(response)

    @app.post("/api/registry/registration-requests/{install_id}/ignore")
    async def registry_ignore_registration(install_id: str) -> object:
        response = await upstream.registry_admin(
            "POST",
            f"/api/admin/registration-requests/{install_id}/ignore",
        )
        return await passthrough_response(response)

    @app.patch("/api/registry/allowlist/{relay_id}")

    async def registry_patch_relay(relay_id: str, request: Request) -> object:

        return await proxy_json(

            upstream,

            target="registry",

            method="PATCH",

            path=f"/api/admin/allowlist/{relay_id}",

            request=request,

        )

    @app.delete("/api/registry/allowlist/{relay_id}")
    async def registry_delete_relay(relay_id: str) -> object:
        response = await upstream.registry_admin(
            "DELETE",
            f"/api/admin/allowlist/{relay_id}",
        )
        return await passthrough_response(response)



    @app.get("/api/relay/overview")

    async def relay_overview() -> object:

        response = await upstream.relay_admin("GET", "/api/admin/overview")

        return await passthrough_response(response)



    @app.get("/api/relay/db")
    async def relay_db() -> object:
        response = await upstream.relay_admin("GET", "/api/admin/db")
        if response.status_code >= 400:
            return await passthrough_response(response)
        payload = response.json()
        if isinstance(payload, dict):
            enrich_admin_db_payload(payload, RELAY_DB_PRIMARY_KEYS)
            return payload
        return await passthrough_response(response)

    @app.post("/api/relay/db/rows/delete")
    async def relay_delete_db_row(request: Request) -> object:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        table = body.get("table")
        keys = body.get("keys")
        if not isinstance(table, str) or not isinstance(keys, dict):
            raise HTTPException(status_code=400, detail="table and keys are required")

        response = await upstream.relay_admin(
            "POST",
            "/api/admin/db/rows/delete",
            json_body=body,
        )
        if response.status_code < 400:
            return await passthrough_response(response)
        if response.status_code == 404:
            try:
                payload = response.json()
                detail = payload.get("detail") if isinstance(payload, dict) else None
            except Exception:
                detail = None
            if not is_missing_upstream_route(detail):
                return await passthrough_response(response)
        elif response.status_code != 502:
            return await passthrough_response(response)

        db_path = resolve_database_path(settings.relay_config_path)
        try:
            deleted = await asyncio.to_thread(
                delete_sqlite_row,
                db_path,
                table=table,
                keys=keys,
                primary_keys=RELAY_DB_PRIMARY_KEYS,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not deleted:
            raise HTTPException(status_code=404, detail="row not found")
        return {"result": "deleted", "table": table, "keys": keys}

    @app.get("/api/relay/health")

    async def relay_health() -> object:

        response = await upstream.relay_public("GET", "/health")

        return await passthrough_response(response)

    @app.post("/api/relay/registration-request")
    async def relay_registration_request(request: Request) -> object:
        body: dict[str, object] = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            try:
                parsed = await request.json()
            except Exception:
                parsed = None
            if isinstance(parsed, dict):
                body = parsed

        registry_url = body.get("registryUrl")
        if not isinstance(registry_url, str) or not registry_url.strip():
            raise HTTPException(status_code=400, detail="registryUrl is required")
        registry_url = write_relay_registry_url(
            settings.relay_config_path,
            registry_url,
        )

        try:
            await upstream.relay_admin(
                "PATCH",
                "/api/admin/registry",
                json_body={"url": registry_url},
            )
        except HTTPException:
            pass

        response = await upstream.relay_admin(
            "POST",
            "/api/admin/registration-request",
        )
        return await passthrough_response(response)



    app.state.config = settings

    app.state.upstream = upstream

    app.state.launcher = launcher

    return app

