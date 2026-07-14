"""Striping and replica placement planning.

Healthy relays are expected already ordered (prefer lower storage_rate).
Config knobs come from PlacementPolicy; this module only runs the math.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HealthyRelay:
    """A candidate relay for upload placement."""

    relay_id: str
    relay_base_url: str
    storage_rate: float
    block_max_age_seconds: int = 86400
    block_sweep_interval_seconds: int = 3600


@dataclass(frozen=True)
class StripeReplicaChoice:
    """Chosen stripe width S and file-level replica factor R."""

    stripe_count: int
    replica_factor: int


def choose_stripe_replica(
    *,
    block_count: int,
    healthy_count: int,
    stripe_target_relays: int,
    max_file_replica_count: int,
) -> StripeReplicaChoice:
    """Stripe–replica sizing: pick (S, R) that maximizes layout capacity.

    Score is S×(1+R). Among equal scores, prefer a larger S.
    S cannot exceed the stripe target, block count, or healthy relay count;
    R(S) is min(max_file_replica_count, (healthy_count − S) // S).
    """
    s_max = min(stripe_target_relays, block_count, healthy_count)
    if s_max < 1:
        return StripeReplicaChoice(stripe_count=1, replica_factor=0)

    best_s = 1
    best_r = 0
    best_score = 1

    for s in range(s_max, 0, -1):
        if healthy_count < s:
            continue
        r = min(max_file_replica_count, max(0, (healthy_count - s) // s))
        score = s * (1 + r)
        if score > best_score or (score == best_score and s > best_s):
            best_s = s
            best_r = r
            best_score = score

    return StripeReplicaChoice(stripe_count=best_s, replica_factor=best_r)


def replica_count_per_block(
    *,
    replica_factor: int,
    max_replicas_per_block: int,
) -> int:
    """How many replica copies each block gets besides its primary.

    Bounded by the file-level replica factor R and max_replicas_per_block − 1.
    """
    if replica_factor <= 0:
        return 0
    return min(replica_factor, max_replicas_per_block - 1)


@dataclass(frozen=True)
class PlannedPlacement:
    """One token on one relay with role primary or replica."""

    token: str
    block_hash: str
    relay_id: str
    relay_base_url: str
    role: str


def plan_token_placements(
    entries: list[tuple[str, str]],
    healthy: list[HealthyRelay],
    *,
    stripe_target_relays: int,
    max_file_replica_count: int,
    max_replicas_per_block: int,
) -> tuple[StripeReplicaChoice, list[PlannedPlacement]]:
    """Token–relay assignment: map each block token onto stripe primaries and replicas.

    First chooses (S, R) via stripe–replica sizing. The first S healthy relays
    form the primary pool (token i → primary[i % S]); the next S×R relays form
    the replica pool, rotated per token. Returns the (S, R) choice plus every
    planned primary/replica row.
    """
    if not entries:
        return StripeReplicaChoice(1, 0), []
    if not healthy:
        raise ValueError("no healthy relay available for placement")

    choice = choose_stripe_replica(
        block_count=len(entries),
        healthy_count=len(healthy),
        stripe_target_relays=stripe_target_relays,
        max_file_replica_count=max_file_replica_count,
    )

    s = choice.stripe_count
    r = choice.replica_factor
    primary_pool = healthy[:s]
    replica_pool = healthy[s : s + s * r] if r > 0 else []
    replicas_per_block = replica_count_per_block(
        replica_factor=r,
        max_replicas_per_block=max_replicas_per_block,
    )

    placements: list[PlannedPlacement] = []
    for index, (token, block_hash) in enumerate(entries):
        primary = primary_pool[index % s]
        placements.append(
            PlannedPlacement(
                token=token,
                block_hash=block_hash,
                relay_id=primary.relay_id,
                relay_base_url=primary.relay_base_url.rstrip("/"),
                role="primary",
            ),
        )
        if replicas_per_block > 0 and replica_pool:
            for replica_index in range(replicas_per_block):
                replica = replica_pool[(index + replica_index) % len(replica_pool)]
                placements.append(
                    PlannedPlacement(
                        token=token,
                        block_hash=block_hash,
                        relay_id=replica.relay_id,
                        relay_base_url=replica.relay_base_url.rstrip("/"),
                        role="replica",
                    ),
                )

    return choice, placements
