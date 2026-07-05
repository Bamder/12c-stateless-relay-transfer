from __future__ import annotations

import base64
import hmac
import hashlib

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

BLOCK_AUTH_INFO_PREFIX = "12C-block-auth-v1:"
BLOCK_AUTH_CANONICAL_PREFIX = "12C-BLOCK-AUTH-v1"
BLOCK_AUTH_ALGORITHM = "HMAC-SHA256-v1"
BLOCK_AUTH_KEY_BYTES = 32


def derive_block_auth_key(
    master_key: bytes,
    *,
    relay_id: str,
    key_id: str,
) -> bytes:
    if len(master_key) < 32:
        raise ValueError("blockAuthMasterKey must be at least 32 bytes")

    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=BLOCK_AUTH_KEY_BYTES,
        salt=relay_id.encode("utf-8"),
        info=f"{BLOCK_AUTH_INFO_PREFIX}{key_id}".encode("utf-8"),
    )
    return hkdf.derive(master_key)


def encode_block_auth_key(key_bytes: bytes) -> str:
    return base64.urlsafe_b64encode(key_bytes).decode("ascii")


def decode_block_auth_key(value: str) -> bytes:
    raw = base64.urlsafe_b64decode(value.encode("ascii"))
    if len(raw) != BLOCK_AUTH_KEY_BYTES:
        raise ValueError("blockAuthKey must decode to 32 bytes")
    return raw


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
