from __future__ import annotations

import unittest

from relay_server.registry.connectivity import (
    record_registry_failure,
    record_registry_success,
    registry_connectivity_snapshot,
)


class RegistryConnectivityTests(unittest.TestCase):
    def test_success_and_failure_snapshots(self) -> None:
        record_registry_success()
        snapshot = registry_connectivity_snapshot()
        self.assertTrue(snapshot["registryContactOk"])
        self.assertIsNone(snapshot["registryContactError"])
        self.assertIsInstance(snapshot["registryContactAt"], str)

        record_registry_failure(RuntimeError("connection refused"))
        snapshot = registry_connectivity_snapshot()
        self.assertFalse(snapshot["registryContactOk"])
        self.assertEqual(snapshot["registryContactError"], "connection refused")
        self.assertIsInstance(snapshot["registryContactAt"], str)


if __name__ == "__main__":
    unittest.main()
