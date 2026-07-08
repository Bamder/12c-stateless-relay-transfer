from __future__ import annotations

import pytest

from registry_server.config import parse_placement_policy
from registry_server.scheduling.policy import PlacementPolicy


def test_parse_placement_policy_nested() -> None:
    policy = parse_placement_policy(
        {
            "placementPolicy": {
                "stripeTargetRelays": 4,
                "maxFileReplicaCount": 2,
                "maxReplicasPerBlock": 3,
                "minGrantTtlSeconds": 1800,
                "clockSkewSeconds": 30,
                "maxRequestedTtlSeconds": 43200,
                "ttlDegradeStepDivisor": 8,
            },
        },
    )
    assert policy == PlacementPolicy(
        stripe_target_relays=4,
        max_file_replica_count=2,
        max_replicas_per_block=3,
        min_grant_ttl_seconds=1800,
        clock_skew_seconds=30,
        max_requested_ttl_seconds=43200,
        ttl_degrade_step_divisor=8,
    )


def test_parse_placement_policy_legacy_root_keys() -> None:
    policy = parse_placement_policy(
        {
            "stripeTargetRelays": 2,
            "maxFileReplicaCount": 0,
            "maxReplicasPerBlock": 1,
        },
    )
    assert policy.stripe_target_relays == 2
    assert policy.max_file_replica_count == 0
    assert policy.max_replicas_per_block == 1
    assert policy.min_grant_ttl_seconds == 3600
    assert policy.clock_skew_seconds == 60


def test_parse_placement_policy_nested_overrides_root() -> None:
    policy = parse_placement_policy(
        {
            "stripeTargetRelays": 9,
            "placementPolicy": {
                "stripeTargetRelays": 2,
            },
        },
    )
    assert policy.stripe_target_relays == 2


def test_parse_placement_policy_invalid_nested_type() -> None:
    with pytest.raises(ValueError, match="placementPolicy must be an object"):
        parse_placement_policy({"placementPolicy": "bad"})
