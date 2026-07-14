"""TTL-aware placement: decide how long tokens may live, then assign relays.

When relays cannot honor the requested TTL, this module degrades the grant
and/or shrinks topology until a feasible subset exists.
"""

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
    """Raised when no healthy relay subset can support a placement grant."""
    pass


def effective_cap_seconds(
    block_max_age_seconds: int,
    *,
    clock_skew_seconds: int,
) -> int:
    """Longest TTL Registry may promise for a relay given its block max age.

    Subtracts clock-skew allowance from the heartbeat-reported blockMaxAge.
    """
    return max(1, block_max_age_seconds - clock_skew_seconds)


def relay_effective_cap(relay: HealthyRelay, policy: PlacementPolicy) -> int:
    """Effective TTL cap for one healthy relay under the current policy."""
    return effective_cap_seconds(
        relay.block_max_age_seconds,
        clock_skew_seconds=policy.clock_skew_seconds,
    )


def count_eligible(
    pool: list[HealthyRelay],
    threshold: int,
    policy: PlacementPolicy,
) -> int:
    """Count relays whose effective TTL cap is at least ``threshold``."""
    return sum(
        1 for relay in pool if relay_effective_cap(relay, policy) >= threshold
    )


def max_threshold_for_count(
    pool: list[HealthyRelay],
    need: int,
    policy: PlacementPolicy,
) -> int | None:
    """Highest TTL threshold that still leaves at least ``need`` eligible relays.

    Tries distinct effective caps from high to low; returns None if none work.
    """
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
    """Preferred number of relays for the upload given current sizing rules.

    Computed as S×(1+R) from stripe–replica sizing, then clamped to
    [1, block_count × max_replicas_per_block].
    """
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
    """TTL degrade search: find the best grantable TTL when the request is too high.

    Starts from the ideal relay count, requires enough relays above a floor
    derived from the cluster max cap and ttl_degrade_step_divisor, then picks
    the highest joint threshold for that count. Shrinks the relay count until
    a feasible grant appears.
    """
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
    """Granted TTL, degrade status, and the resulting token placements."""

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
    """TTL-aware placement: grant a TTL, filter relays, then assign tokens.

    If enough relays already support the requested TTL, grant it as-is.
    Otherwise run TTL degrade search for a lower grantable value. Placements
    are then planned on the filtered pool. Marked degraded when the grant is
    shorter than requested or fewer relays are used than the ideal count.
    """
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
