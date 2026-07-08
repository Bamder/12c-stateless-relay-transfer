from __future__ import annotations

from dataclasses import dataclass

from .placement import (
    HealthyRelay,
    PlannedPlacement,
    StripeReplicaChoice,
    choose_stripe_replica,
    plan_token_placements,
)
from .policy import PlacementPolicy

DEFAULT_BLOCK_MAX_AGE_SECONDS = 86400
DEFAULT_BLOCK_SWEEP_INTERVAL_SECONDS = 3600


class InsufficientRelayCapacityError(RuntimeError):
    pass


def effective_cap_seconds(
    block_max_age_seconds: int,
    *,
    clock_skew_seconds: int,
) -> int:
    """Registry 可承诺的最长 TTL；sweep 只会在块到期后删除，故仅扣除时钟余量。"""
    return max(1, block_max_age_seconds - clock_skew_seconds)


def relay_effective_cap(relay: HealthyRelay, policy: PlacementPolicy) -> int:
    return effective_cap_seconds(
        relay.block_max_age_seconds,
        clock_skew_seconds=policy.clock_skew_seconds,
    )


def count_eligible(
    pool: list[HealthyRelay],
    threshold: int,
    policy: PlacementPolicy,
) -> int:
    return sum(
        1 for relay in pool if relay_effective_cap(relay, policy) >= threshold
    )


def max_threshold_for_count(
    pool: list[HealthyRelay],
    need: int,
    policy: PlacementPolicy,
) -> int | None:
    caps = sorted(
        {relay_effective_cap(relay, policy) for relay in pool},
        reverse=True,
    )
    for cap in caps:
        if count_eligible(pool, cap, policy) >= need:
            return cap
    return None


def ideal_relay_count(
    *,
    block_count: int,
    healthy_count: int,
    policy: PlacementPolicy,
) -> int:
    choice = choose_stripe_replica(
        block_count=block_count,
        healthy_count=healthy_count,
        stripe_target_relays=policy.stripe_target_relays,
        max_file_replica_count=policy.max_file_replica_count,
    )
    ideal_n = choice.stripe_count * (1 + choice.replica_factor)
    return max(
        1,
        min(ideal_n, block_count * policy.max_replicas_per_block),
    )


def find_granted_ttl_with_topology(
    pool: list[HealthyRelay],
    *,
    block_count: int,
    policy: PlacementPolicy,
) -> int:
    if not pool:
        raise InsufficientRelayCapacityError("no healthy relay available")

    cluster_max = max(relay_effective_cap(relay, policy) for relay in pool)
    n = ideal_relay_count(
        block_count=block_count,
        healthy_count=len(pool),
        policy=policy,
    )
    divisor = max(1, policy.ttl_degrade_step_divisor)
    decrement = cluster_max // divisor
    min_grant = policy.min_grant_ttl_seconds
    if decrement > min_grant:
        t_low = min_grant
    else:
        t_low = cluster_max - decrement
    t_low = max(1, min(t_low, cluster_max))

    while n >= 1:
        if count_eligible(pool, t_low, policy) < n:
            n -= 1
            continue
        t_star = max_threshold_for_count(pool, n, policy)
        if t_star is not None:
            return t_star
        n -= 1

    raise InsufficientRelayCapacityError("no relay placement even with n=1")


@dataclass(frozen=True)
class PlacementResolution:
    granted_ttl_seconds: int
    requested_ttl_seconds: int
    degraded: bool
    placement_plan: StripeReplicaChoice
    placements: list[PlannedPlacement]
    ideal_relay_count: int
    actual_relay_count: int


def resolve_placement_with_ttl(
    entries: list[tuple[str, str]],
    healthy: list[HealthyRelay],
    *,
    requested_ttl: int,
    policy: PlacementPolicy,
) -> PlacementResolution:
    if not healthy:
        raise InsufficientRelayCapacityError("no healthy relay available")

    requested_ttl = max(
        1,
        min(policy.max_requested_ttl_seconds, requested_ttl),
    )
    block_count = len(entries)
    ideal_n = ideal_relay_count(
        block_count=block_count,
        healthy_count=len(healthy),
        policy=policy,
    )

    strict_pool = [
        relay
        for relay in healthy
        if relay_effective_cap(relay, policy) >= requested_ttl
    ]
    if strict_pool:
        pool = strict_pool
        granted_ttl = requested_ttl
    else:
        granted_ttl = find_granted_ttl_with_topology(
            healthy,
            block_count=block_count,
            policy=policy,
        )
        pool = [
            relay
            for relay in healthy
            if relay_effective_cap(relay, policy) >= granted_ttl
        ]
        if not pool:
            raise InsufficientRelayCapacityError(
                "no relay satisfies granted ttl after filtering",
            )

    choice, placements = plan_token_placements(
        entries,
        pool,
        stripe_target_relays=policy.stripe_target_relays,
        max_file_replica_count=policy.max_file_replica_count,
        max_replicas_per_block=policy.max_replicas_per_block,
    )
    actual_n = choice.stripe_count * (1 + choice.replica_factor)
    degraded = granted_ttl < requested_ttl or actual_n < ideal_n

    return PlacementResolution(
        granted_ttl_seconds=granted_ttl,
        requested_ttl_seconds=requested_ttl,
        degraded=degraded,
        placement_plan=choice,
        placements=placements,
        ideal_relay_count=ideal_n,
        actual_relay_count=actual_n,
    )
