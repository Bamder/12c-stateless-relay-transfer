from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock


@dataclass
class RegistryConnectivityState:
    last_contact_at: str | None = None
    last_contact_ok: bool | None = None
    last_error: str | None = None


_lock = Lock()
_state = RegistryConnectivityState()


def record_registry_success() -> None:
    with _lock:
        _state.last_contact_at = datetime.now(timezone.utc).isoformat()
        _state.last_contact_ok = True
        _state.last_error = None


def record_registry_failure(error: BaseException | str) -> None:
    message = str(error).strip() if error else ""
    if not message and isinstance(error, BaseException):
        message = error.__class__.__name__
    with _lock:
        _state.last_contact_at = datetime.now(timezone.utc).isoformat()
        _state.last_contact_ok = False
        _state.last_error = message or "registry contact failed"


def registry_connectivity_snapshot() -> dict[str, object]:
    with _lock:
        return {
            "registryContactAt": _state.last_contact_at,
            "registryContactOk": _state.last_contact_ok,
            "registryContactError": _state.last_error,
        }
