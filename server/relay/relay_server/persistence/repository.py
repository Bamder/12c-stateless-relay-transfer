from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_block_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class BlockRepository:
    """token ↔ 磁盘路径 映射（关系型 SQLite）。"""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    async def initialize(self) -> None:
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._database_path) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS blocks (
                    token TEXT PRIMARY KEY,
                    disk_path TEXT NOT NULL UNIQUE,
                    block_hash TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """,
            )
            await db.commit()

    async def get(self, token: str) -> dict[str, object] | None:
        async with aiosqlite.connect(self._database_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT token, disk_path, block_hash, size_bytes, created_at, updated_at
                FROM blocks
                WHERE token = ?
                """,
                (token,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            return dict(row)

    async def count(self) -> int:
        async with aiosqlite.connect(self._database_path) as db:
            cursor = await db.execute("SELECT COUNT(*) FROM blocks")
            row = await cursor.fetchone()
            return int(row[0]) if row is not None else 0

    async def insert(
        self,
        *,
        token: str,
        disk_path: str,
        block_hash: str,
        size_bytes: int,
    ) -> None:
        now = utc_now_iso()
        async with aiosqlite.connect(self._database_path) as db:
            await db.execute(
                """
                INSERT INTO blocks (
                    token, disk_path, block_hash, size_bytes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token, disk_path, block_hash, size_bytes, now, now),
            )
            await db.commit()

    async def update(
        self,
        *,
        token: str,
        block_hash: str,
        size_bytes: int,
    ) -> None:
        now = utc_now_iso()
        async with aiosqlite.connect(self._database_path) as db:
            await db.execute(
                """
                UPDATE blocks
                SET block_hash = ?, size_bytes = ?, updated_at = ?
                WHERE token = ?
                """,
                (block_hash, size_bytes, now, token),
            )
            await db.commit()

    async def delete(self, token: str) -> None:
        async with aiosqlite.connect(self._database_path) as db:
            await db.execute("DELETE FROM blocks WHERE token = ?", (token,))
            await db.commit()

    async def list_stale_blocks(self, updated_before: str) -> list[tuple[str, str]]:
        async with aiosqlite.connect(self._database_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT token, disk_path
                FROM blocks
                WHERE updated_at <= ?
                """,
                (updated_before,),
            )
            rows = await cursor.fetchall()
            return [(str(row["token"]), str(row["disk_path"])) for row in rows]

    async def list_disk_paths(self) -> list[str]:
        async with aiosqlite.connect(self._database_path) as db:
            cursor = await db.execute("SELECT disk_path FROM blocks")
            rows = await cursor.fetchall()
            return [str(row[0]) for row in rows]

    async def export_admin_database(self, *, row_limit: int = 500) -> dict[str, object]:
        async with aiosqlite.connect(self._database_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT COUNT(*) FROM blocks")
            count_row = await cursor.fetchone()
            total = int(count_row[0]) if count_row is not None else 0
            cursor = await db.execute(
                "SELECT token, disk_path, block_hash, size_bytes, created_at, updated_at "
                "FROM blocks ORDER BY updated_at DESC LIMIT ?",
                (row_limit,),
            )
            rows = await cursor.fetchall()
            table_rows = [{key: row[key] for key in row.keys()} for row in rows]
        return {
            "rowLimit": row_limit,
            "tables": {
                "blocks": {
                    "totalRows": total,
                    "truncated": total > len(table_rows),
                    "primaryKey": ["token"],
                    "rows": table_rows,
                },
            },
        }

    async def delete_admin_db_row(
        self,
        *,
        table: str,
        keys: dict[str, object],
    ) -> bool:
        if table != "blocks":
            raise ValueError(f"table not deletable: {table}")
        token = keys.get("token")
        if not isinstance(token, str) or not token:
            raise ValueError("missing primary key column: token")
        async with aiosqlite.connect(self._database_path) as db:
            cursor = await db.execute(
                "DELETE FROM blocks WHERE token = ?",
                (token,),
            )
            await db.commit()
            return cursor.rowcount > 0
