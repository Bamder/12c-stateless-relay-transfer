from __future__ import annotations

from registry_server.scheduling.policy import PlacementPolicy

DEFAULT_TEST_PLACEMENT_POLICY = PlacementPolicy(
    stripe_target_relays=3,
    max_file_replica_count=1,
    max_replicas_per_block=2,
)
