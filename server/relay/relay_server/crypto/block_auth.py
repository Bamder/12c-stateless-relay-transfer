from __future__ import annotations

import base64
import hmac
import hashlib
from datetime import datetime, timezone

BLOCK_AUTH_CANONICAL_PREFIX = "12C-BLOCK-AUTH-v1"
BLOCK_AUTH_ALGORITHM = "HMAC-SHA256-v1"
BLOCK_AUTH_KEY_BYTES = 32


def build_block_auth_canonical(
    *,
    block_auth_key_id: str,
    token: str,
    relay_id: str,
    relay_base_url: str,
    block_hash: str,
    expiry_at: str,
) -> str:
    return "|".join(
        [
            BLOCK_AUTH_CANONICAL_PREFIX,
            block_auth_key_id,
            token.lower(),
            relay_id,
            relay_base_url.rstrip("/"),
            block_hash.lower(),
            expiry_at,
        ],
    )


def compute_block_auth_mac(key_bytes: bytes, canonical: str) -> str:
    digest = hmac.new(key_bytes, canonical.encode("utf-8"), hashlib.sha256).digest()
    return digest.hex()


def decode_block_auth_key(value: str) -> bytes:
    raw = base64.urlsafe_b64decode(value.encode("ascii"))
    if len(raw) != BLOCK_AUTH_KEY_BYTES:
        raise ValueError("blockAuthKey must decode to 32 bytes")
    return raw


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def verify_block_auth_mac(
    *,
    block_auth_key: bytes,
    block_auth_key_id: str,
    token: str,
    relay_id: str,
    relay_base_url: str,
    block_hash: str,
    expiry_at: str,
    mac_hex: str,
) -> bool:
    if parse_iso(expiry_at) <= datetime.now(timezone.utc):
        return False
    canonical = build_block_auth_canonical(
        block_auth_key_id=block_auth_key_id,
        token=token,
        relay_id=relay_id,
        relay_base_url=relay_base_url,
        block_hash=block_hash,
        expiry_at=expiry_at,
    )
    expected = compute_block_auth_mac(block_auth_key, canonical)
    return hmac.compare_digest(expected, mac_hex.lower())
