from __future__ import annotations

import json
import uuid
from pathlib import Path

INSTALL_ID_FILENAME = "install_id.json"
ASSIGNED_RELAY_ID_FILENAME = "assigned_relay_id.json"


class RelayIdentityManager:
    def __init__(self, secrets_dir: Path) -> None:
        self._secrets_dir = secrets_dir
        self._install_path = secrets_dir / INSTALL_ID_FILENAME
        self._assigned_path = secrets_dir / ASSIGNED_RELAY_ID_FILENAME
        self._install_id: str | None = None
        self._assigned_relay_id: str | None = None

    def load(self) -> None:
        self._secrets_dir.mkdir(parents=True, exist_ok=True)
        self._install_id = self._read_install_id()
        self._assigned_relay_id = self._read_assigned_relay_id()

    @property
    def install_id(self) -> str:
        if self._install_id is None:
            raise RuntimeError("relay identity not loaded")
        return self._install_id

    @property
    def relay_id(self) -> str | None:
        return self._assigned_relay_id

    @property
    def is_assigned(self) -> bool:
        return bool(self._assigned_relay_id)

    def assign_relay_id(self, relay_id: str) -> None:
        normalized = relay_id.strip()
        if not normalized:
            raise ValueError("relayId must be non-empty")
        self._assigned_relay_id = normalized
        self._assigned_path.write_text(
            json.dumps({"relayId": normalized}, indent=2) + "\n",
            encoding="utf-8",
        )

    def clear_relay_id(self) -> bool:
        if not self._assigned_relay_id:
            return False
        self._assigned_relay_id = None
        if self._assigned_path.is_file():
            self._assigned_path.unlink()
        return True

    def _read_install_id(self) -> str:
        if self._install_path.is_file():
            with self._install_path.open(encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                value = data.get("installId")
                if isinstance(value, str) and value.strip():
                    return value.strip()
        install_id = str(uuid.uuid4())
        self._install_path.write_text(
            json.dumps({"installId": install_id}, indent=2) + "\n",
            encoding="utf-8",
        )
        return install_id

    def _read_assigned_relay_id(self) -> str | None:
        if not self._assigned_path.is_file():
            return None
        with self._assigned_path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return None
        value = data.get("relayId")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None
