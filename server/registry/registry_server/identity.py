from __future__ import annotations

import secrets


def generate_relay_id(*, reserved: set[str]) -> str:
    for _ in range(32):
        candidate = f"relay-{secrets.token_hex(4)}"
        if candidate not in reserved:
            return candidate
    raise RuntimeError("failed to generate unique relay id")
