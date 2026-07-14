from __future__ import annotations

from registry_server.scheduling.read_steering import (
    DownloadTargetCandidate,
    order_download_targets_by_load,
)


def test_order_download_targets_prefers_lowest_storage_rate() -> None:
    ordered = order_download_targets_by_load(
        [
            DownloadTargetCandidate("primary", "a", "http://a.test", 0.9),
            DownloadTargetCandidate("replica", "b", "http://b.test", 0.05),
            DownloadTargetCandidate("replica", "c", "http://c.test", 0.4),
        ],
    )
    assert [item.relay_id for item in ordered] == ["b", "c", "a"]
    assert ordered[0].role == "replica"


def test_order_download_targets_tie_breaks_to_primary() -> None:
    ordered = order_download_targets_by_load(
        [
            DownloadTargetCandidate("replica", "b", "http://b.test", 0.2),
            DownloadTargetCandidate("primary", "a", "http://a.test", 0.2),
        ],
    )
    assert [item.relay_id for item in ordered] == ["a", "b"]
