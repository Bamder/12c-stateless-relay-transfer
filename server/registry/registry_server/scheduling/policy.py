from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlacementPolicy:
    """Registry 上传布局与 TTL 降级策略（由 registry_server.config.json 注入）。"""

    stripe_target_relays: int
    max_file_replica_count: int
    max_replicas_per_block: int
    min_grant_ttl_seconds: int = 3600
    clock_skew_seconds: int = 60
    max_requested_ttl_seconds: int = 86400
    ttl_degrade_step_divisor: int = 4
