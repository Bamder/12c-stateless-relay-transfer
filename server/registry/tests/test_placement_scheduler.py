from __future__ import annotations

import pytest

from registry_server.scheduling.placement import (
    HealthyRelay,
    choose_stripe_replica,
    plan_token_placements,
    replica_count_per_block,
)


def relay(index: int) -> HealthyRelay:
    return HealthyRelay(
        relay_id=f"relay-{index}",
        relay_base_url=f"http://relay-{index}.test",
        storage_rate=float(index),
    )


@pytest.mark.parametrize(
    ("healthy_count", "expected"),
    [
        (1, (1, 0)),
        (2, (2, 0)),
        (3, (3, 0)),
        (4, (2, 1)),
        (5, (2, 1)),
        (6, (3, 1)),
        (9, (3, 2)),
    ],
)
def test_choose_stripe_replica_table(
    healthy_count: int,
    expected: tuple[int, int],
) -> None:
    choice = choose_stripe_replica(
        block_count=healthy_count,
        healthy_count=healthy_count,
        stripe_target_relays=3,
        max_file_replica_count=2,
    )
    assert (choice.stripe_count, choice.replica_factor) == expected


def test_choose_stripe_replica_limited_by_block_count() -> None:
    choice = choose_stripe_replica(
        block_count=2,
        healthy_count=6,
        stripe_target_relays=3,
        max_file_replica_count=1,
    )
    assert choice.stripe_count == 2
    assert choice.replica_factor == 1


def test_plan_token_placements_stripe_only_when_budget_tight() -> None:
    healthy = [relay(0), relay(1), relay(2)]
    entries = [("token-a", "hash-a"), ("token-b", "hash-b"), ("token-c", "hash-c")]
    choice, placements = plan_token_placements(
        entries,
        healthy,
        stripe_target_relays=3,
        max_file_replica_count=1,
        max_replicas_per_block=2,
    )
    assert choice.stripe_count == 3
    assert choice.replica_factor == 0
    assert len(placements) == 3
    assert all(item.role == "primary" for item in placements)


def test_plan_token_placements_with_replicas() -> None:
    healthy = [relay(index) for index in range(6)]
    entries = [("token-a", "hash-a"), ("token-b", "hash-b")]
    _, placements = plan_token_placements(
        entries,
        healthy,
        stripe_target_relays=3,
        max_file_replica_count=1,
        max_replicas_per_block=2,
    )
    primary = [item for item in placements if item.role == "primary"]
    replica = [item for item in placements if item.role == "replica"]
    assert len(primary) == 2
    assert len(replica) == 2
    assert primary[0].relay_id == "relay-0"
    assert primary[1].relay_id == "relay-1"
    assert {item.relay_id for item in replica} == {"relay-2", "relay-3"}
    assert replica_count_per_block(replica_factor=1, max_replicas_per_block=2) == 1
