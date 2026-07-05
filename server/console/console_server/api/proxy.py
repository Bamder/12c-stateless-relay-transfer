from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, Request, Response


class UpstreamClient:
    def __init__(
        self,
        *,
        registry_base_url: str,
        relay_base_url: str,
        registry_admin_api_key: str,
        relay_admin_api_key: str,
    ) -> None:
        self._registry_base_url = registry_base_url.rstrip("/")
        self._relay_base_url = relay_base_url.rstrip("/")
        self._registry_admin_api_key = registry_admin_api_key
        self._relay_admin_api_key = relay_admin_api_key
        self._client = httpx.AsyncClient(timeout=30.0, trust_env=False)

    async def close(self) -> None:
        await self._client.aclose()

    async def registry_admin(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        return await self._request(
            base_url=self._registry_base_url,
            method=method,
            path=path,
            admin_key=self._registry_admin_api_key,
            json_body=json_body,
        )

    async def relay_admin(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        return await self._request(
            base_url=self._relay_base_url,
            method=method,
            path=path,
            admin_key=self._relay_admin_api_key,
            json_body=json_body,
        )

    async def relay_public(self, method: str, path: str) -> httpx.Response:
        url = f"{self._relay_base_url}{path}"
        try:
            return await self._client.request(method, url)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"relay unreachable: {exc}") from exc

    async def registry_relay_api(
        self,
        registry_base_url: str,
        method: str,
        path: str,
        *,
        json_body: dict[str, object] | None = None,
    ) -> httpx.Response:
        url = f"{registry_base_url.rstrip('/')}{path}"
        try:
            return await self._client.request(method, url, json=json_body)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"registry unreachable: {exc}",
            ) from exc

    async def _request(
        self,
        *,
        base_url: str,
        method: str,
        path: str,
        admin_key: str,
        json_body: dict[str, Any] | None,
    ) -> httpx.Response:
        url = f"{base_url}{path}"
        headers = {"Authorization": f"Bearer {admin_key}"}
        try:
            return await self._client.request(
                method,
                url,
                headers=headers,
                json=json_body,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"upstream unreachable: {exc}") from exc


def upstream_error_detail(response: httpx.Response) -> str:
    detail = response.text.strip()
    if not detail:
        detail = response.reason_phrase or f"HTTP {response.status_code}"
    try:
        payload = response.json()
        if isinstance(payload, dict) and payload.get("detail") is not None:
            detail = str(payload["detail"])
    except Exception:
        pass
    return detail


async def passthrough_response(response: httpx.Response) -> Response:
    content_type = response.headers.get("content-type", "application/json")
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=content_type,
    )


async def proxy_json(
    client: UpstreamClient,
    *,
    target: str,
    method: str,
    path: str,
    request: Request | None = None,
) -> Response:
    json_body = None
    if request is not None and method.upper() in {"POST", "PATCH", "PUT"}:
        json_body = await request.json()

    if target == "registry":
        response = await client.registry_admin(method, path, json_body=json_body)
    elif target == "relay":
        response = await client.relay_admin(method, path, json_body=json_body)
    else:
        raise HTTPException(status_code=500, detail="unknown proxy target")

    if response.status_code >= 400:
        detail = response.text
        try:
            payload = response.json()
            if isinstance(payload, dict) and "detail" in payload:
                detail = str(payload["detail"])
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return await passthrough_response(response)
