"""SQLite-backed OHLC cache."""

import sqlite3
import os
from datetime import datetime, timezone

DB_PATH = os.environ.get(
    "CHARTVIEWER_DB_PATH",
    os.path.join(os.path.dirname(__file__), "ohlc_cache.db"),
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ohlc (
                symbol   TEXT    NOT NULL,
                interval TEXT    NOT NULL,
                ts       INTEGER NOT NULL,
                open     REAL    NOT NULL,
                high     REAL    NOT NULL,
                low      REAL    NOT NULL,
                close    REAL    NOT NULL,
                PRIMARY KEY (symbol, interval, ts)
            );

            CREATE TABLE IF NOT EXISTS fetch_meta (
                symbol       TEXT    NOT NULL,
                interval     TEXT    NOT NULL,
                fetched_from INTEGER NOT NULL,
                fetched_to   INTEGER NOT NULL,
                last_updated INTEGER NOT NULL,
                PRIMARY KEY (symbol, interval)
            );
        """)


def get_cached_bars(symbol: str, interval: str, start_ts: int, end_ts: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT ts, open, high, low, close
            FROM ohlc
            WHERE symbol = ? AND interval = ? AND ts >= ? AND ts <= ?
            ORDER BY ts
            """,
            (symbol, interval, start_ts, end_ts),
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_bars(symbol: str, interval: str, bars: list[dict]):
    if not bars:
        return
    with _connect() as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO ohlc (symbol, interval, ts, open, high, low, close)
            VALUES (:symbol, :interval, :ts, :open, :high, :low, :close)
            """,
            [{"symbol": symbol, "interval": interval, **b} for b in bars],
        )


def get_fetch_meta(symbol: str, interval: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM fetch_meta WHERE symbol = ? AND interval = ?",
            (symbol, interval),
        ).fetchone()
    return dict(row) if row else None


def set_fetch_meta(symbol: str, interval: str, fetched_from: int, fetched_to: int):
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO fetch_meta
                (symbol, interval, fetched_from, fetched_to, last_updated)
            VALUES (?, ?, ?, ?, ?)
            """,
            (symbol, interval, fetched_from, fetched_to, now),
        )


def seconds_since_last_update(symbol: str, interval: str) -> float | None:
    meta = get_fetch_meta(symbol, interval)
    if not meta:
        return None
    now = datetime.now(timezone.utc).timestamp()
    return now - meta["last_updated"]
