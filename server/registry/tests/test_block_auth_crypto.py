import unittest

from registry_server.crypto.block_auth import (
    BLOCK_AUTH_ALGORITHM,
    build_block_auth_canonical,
    compute_block_auth_mac,
    decode_block_auth_key,
    derive_block_auth_key,
    encode_block_auth_key,
)


class BlockAuthCryptoTests(unittest.TestCase):
    def test_derive_and_mac_roundtrip(self) -> None:
        master = b"x" * 32
        relay_id = "relay-1"
        key_id = "key-alpha-001"
        token = "a" * 64
        block_hash = "b" * 64
        expiry_at = "2026-07-03T12:00:00+00:00"
        relay_base_url = "http://127.0.0.1:9090"

        key_bytes = derive_block_auth_key(master, relay_id=relay_id, key_id=key_id)
        self.assertEqual(len(key_bytes), 32)

        encoded = encode_block_auth_key(key_bytes)
        self.assertEqual(decode_block_auth_key(encoded), key_bytes)

        canonical = build_block_auth_canonical(
            block_auth_key_id=key_id,
            token=token,
            relay_id=relay_id,
            relay_base_url=relay_base_url,
            block_hash=block_hash,
            expiry_at=expiry_at,
        )
        self.assertTrue(canonical.startswith("12C-BLOCK-AUTH-v1|"))

        mac = compute_block_auth_mac(key_bytes, canonical)
        self.assertEqual(len(mac), 64)
        self.assertEqual(BLOCK_AUTH_ALGORITHM, "HMAC-SHA256-v1")

        mac_again = compute_block_auth_mac(key_bytes, canonical)
        self.assertEqual(mac, mac_again)


if __name__ == "__main__":
    unittest.main()
