from __future__ import annotations

from secrets import compare_digest

from fastapi import Header, HTTPException, Request

from ..config import RegistryServerConfig
from ..services.registry import ResolveRouteResult


def serialize_route(route: ResolveRouteResult) -> dict[str, object]:
    payload: dict[str, object] = {
        "token": route.token,
        "targets": [
            {
                "role": target.role,
                "relayId": target.relay_id,
                "relayBaseUrl": target.relay_base_url,
            }
            for target in route.targets
        ],
    }
    if route.resolve_status != "ready":
        payload["resolveStatus"] = route.resolve_status
    return payload


def _extract_admin_api_key(
    authorization: str | None,
    x_registry_admin_key: str | None,
) -> str | None:
    if authorization is not None:
        prefix = "Bearer "
        if authorization.startswith(prefix):
            token = authorization[len(prefix) :].strip()
            if token:
                return token
    if x_registry_admin_key is not None and x_registry_admin_key.strip():
        return x_registry_admin_key.strip()
    return None


def require_admin_api_key(
    request: Request,
    authorization: str | None = Header(default=None),
    x_registry_admin_key: str | None = Header(default=None, alias="X-Registry-Admin-Key"),
) -> None:
    settings: RegistryServerConfig = request.app.state.config
    if settings.admin_api_key is None:
        raise HTTPException(status_code=503, detail="admin API is not configured")
    token = _extract_admin_api_key(authorization, x_registry_admin_key)
    if token is None or not compare_digest(token, settings.admin_api_key):
        raise HTTPException(status_code=401, detail="invalid admin API key")
