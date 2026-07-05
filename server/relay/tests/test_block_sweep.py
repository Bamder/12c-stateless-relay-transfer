import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiosqlite

from relay_server.persistence.repository import BlockRepository
from relay_server.persistence.disk_store import DiskBlockStore


class BlockSweepStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.data_dir = self.root / "blocks"
        self.db_path = self.root / "relay.db"
        self.repository = BlockRepository(self.db_path)
        self.disk_store = DiskBlockStore(self.data_dir)
        await self.repository.initialize()
        self.disk_store.initialize()
        self.max_age = 60
        self.cutoff_iso = (
            datetime.now(timezone.utc) - timedelta(seconds=self.max_age)
        ).isoformat()

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_list_stale_blocks_and_remove(self) -> None:
        token = "a" * 64
        disk_path = self.disk_store.relative_disk_path(token)
        await self.disk_store.write(token, b"payload")
        stale_time = (
            datetime.now(timezone.utc) - timedelta(seconds=120)
        ).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO blocks (
                    token, disk_path, block_hash, size_bytes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token, disk_path, "hash", 7, stale_time, stale_time),
            )
            await db.commit()

        stale = await self.repository.list_stale_blocks(self.cutoff_iso)
        self.assertEqual(stale, [(token, disk_path)])

        await self.disk_store.remove(disk_path)
        await self.repository.delete(token)
        self.assertIsNone(await self.repository.get(token))
        self.assertIsNone(await self.disk_store.read(disk_path))

    async def test_sweep_orphan_files(self) -> None:
        token = "b" * 64
        path = self.disk_store.disk_path_for_token(token)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"orphan")
        old = time.time() - 120
        os.utime(path, (old, old))

        removed = await self.disk_store.sweep_orphan_files(
            active_relative_paths=set(),
            max_age_seconds=self.max_age,
        )

        self.assertEqual(removed, 1)
        self.assertFalse(path.is_file())

    async def test_orphan_sweep_skips_active_paths(self) -> None:
        token = "c" * 64
        disk_path = self.disk_store.relative_disk_path(token)
        await self.disk_store.write(token, b"fresh")
        await self.repository.insert(
            token=token,
            disk_path=disk_path,
            block_hash="hash",
            size_bytes=5,
        )

        removed = await self.disk_store.sweep_orphan_files(
            active_relative_paths={disk_path},
            max_age_seconds=self.max_age,
        )

        self.assertEqual(removed, 0)
        self.assertIsNotNone(await self.disk_store.read(disk_path))


if __name__ == "__main__":
    unittest.main()
