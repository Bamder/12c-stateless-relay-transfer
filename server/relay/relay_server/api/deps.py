from __future__ import annotations

import re
from urllib.parse import unquote

from fastapi import HTTPException

TOKEN_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def normalize_token(raw_token: str) -> str:
    token = unquote(raw_token)
    if not TOKEN_PATTERN.fullmatch(token):
        raise HTTPException(status_code=400, detail="invalid token format")
    return token.lower()
