"""PlacementPolicy: numeric knobs for striping, replicas, and TTL grants.

Loaded from registry_server.config.json (placementPolicy). Algorithm logic
lives in the scheduling modules that take this object as input.

Download single-token read steering (read_steering.py) currently uses
heartbeat storage_rate only and does not read this config bag.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlacementPolicy:
    """Config for upload layout and TTL degrade limits (parameters only)."""

    stripe_target_relays: int
    max_file_replica_count: int
    max_replicas_per_block: int
    min_grant_ttl_seconds: int = 3600
    clock_skew_seconds: int = 60
    max_requested_ttl_seconds: int = 86400
    ttl_degrade_step_divisor: int = 4
