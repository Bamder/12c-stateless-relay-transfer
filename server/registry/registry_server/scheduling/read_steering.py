"""Single-token read steering for download resolve.

Orders live holders of one token so the client prefers the lightest relay
first. A light replica may rank ahead of a busy primary.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DownloadTargetCandidate:
    """One live holder of a token that may serve a download GET."""

    role: str
    relay_id: str
    relay_base_url: str
    storage_rate: float


def order_download_targets_by_load(
    candidates: list[DownloadTargetCandidate],
) -> list[DownloadTargetCandidate]:
    """Single-token read steering: prefer the lowest storage_rate holder first.

    Among equal load, prefer primary over replica, then stable relay_id order.
    Does not filter health or expiry; callers must pass only live candidates
    and must still require a live primary elsewhere if that remains a gate.
    """
    return sorted(
        candidates,
        key=lambda target: (
            target.storage_rate,
            0 if target.role == "primary" else 1,
            target.relay_id,
        ),
    )
