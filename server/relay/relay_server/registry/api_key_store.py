from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey


@dataclass
class RegistryApiKeyStore:
    registry_api_key_id: str
    registry_api_key: str
    remaining_uses: int
    updated_at: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_or_create_rsa_private_pem(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        return path.read_text(encoding="utf-8")

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    path.write_text(private_pem, encoding="utf-8")
    return private_pem


def private_key_to_public_pem(private_key_pem: str) -> str:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    if not isinstance(private_key, RSAPrivateKey):
        raise ValueError("relay private key must be RSA")
    public_key = private_key.public_key()
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")


def load_registry_api_key_store(path: Path) -> RegistryApiKeyStore | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return RegistryApiKeyStore(
        registry_api_key_id=str(data["registryApiKeyId"]),
        registry_api_key=str(data["registryApiKey"]),
        remaining_uses=int(data.get("remainingUses", 0)),
        updated_at=str(data.get("updatedAt", utc_now_iso())),
    )


def save_registry_api_key_store(path: Path, store: RegistryApiKeyStore) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "registryApiKeyId": store.registry_api_key_id,
        "registryApiKey": store.registry_api_key,
        "remainingUses": store.remaining_uses,
        "updatedAt": store.updated_at,
    }
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(path)


def delete_registry_api_key_store(path: Path) -> None:
    if path.is_file():
        path.unlink()


def decrypt_next_registry_api_key(
    private_key_pem: str,
    encrypted_registry_api_key_b64: str,
) -> str:
    return decrypt_secret_bytes(private_key_pem, encrypted_registry_api_key_b64).decode(
        "utf-8",
    )


def decrypt_secret_bytes(private_key_pem: str, encrypted_b64: str) -> bytes:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    if not isinstance(private_key, RSAPrivateKey):
        raise ValueError("relay private key must be RSA")

    ciphertext = base64.b64decode(encrypted_b64.encode("ascii"))
    return private_key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
