from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey


def hash_registry_api_key(registry_api_key: str) -> str:
    return hashlib.sha256(registry_api_key.encode("utf-8")).hexdigest()


def encrypt_registry_api_key_for_relay(public_key_pem: str, registry_api_key: str) -> str:
    return encrypt_secret_bytes_for_relay(
        public_key_pem,
        registry_api_key.encode("utf-8"),
    )


def encrypt_secret_bytes_for_relay(public_key_pem: str, secret: bytes) -> str:
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    if not isinstance(public_key, RSAPublicKey):
        raise ValueError("relay public key must be RSA")

    ciphertext = public_key.encrypt(
        secret,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode("ascii")


def decrypt_registry_api_key(private_key_pem: str, encrypted_key_b64: str) -> str:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    if not isinstance(private_key, RSAPrivateKey):
        raise ValueError("relay private key must be RSA")

    ciphertext = base64.b64decode(encrypted_key_b64.encode("ascii"))
    plaintext = private_key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return plaintext.decode("utf-8")
