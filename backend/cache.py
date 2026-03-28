"""SQLite-backed OHLC cache and user data store."""

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
    conn.execute("PRAGMA foreign_keys = ON")
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

            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                created_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS invite_tokens (
                token      TEXT    PRIMARY KEY,
                created_by INTEGER NOT NULL REFERENCES users(id),
                used_by    INTEGER REFERENCES users(id),
                created_at INTEGER NOT NULL,
                used_at    INTEGER
            );

            CREATE TABLE IF NOT EXISTS preferences (
                user_id  INTEGER PRIMARY KEY REFERENCES users(id),
                ticker   TEXT,
                interval TEXT,
                date     TEXT
            );
        """)
        _migrate_watchlist(conn)


def _migrate_watchlist(conn: sqlite3.Connection):
    """Migrate watchlist to per-user schema if user_id column is absent."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(watchlist)").fetchall()}
    if "user_id" in cols:
        return  # already migrated

    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}

    old_rows = []
    if "watchlist" in tables:
        old_rows = conn.execute(
            "SELECT position, ticker, label FROM watchlist ORDER BY position"
        ).fetchall()
        conn.execute("DROP TABLE watchlist")

    conn.execute("""
        CREATE TABLE watchlist (
            user_id  INTEGER NOT NULL REFERENCES users(id),
            position INTEGER NOT NULL,
            ticker   TEXT    NOT NULL,
            label    TEXT    NOT NULL,
            PRIMARY KEY (user_id, ticker)
        )
    """)

    if old_rows:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist_migration (
                position INTEGER NOT NULL,
                ticker   TEXT    NOT NULL,
                label    TEXT    NOT NULL
            )
        """)
        conn.executemany(
            "INSERT OR IGNORE INTO watchlist_migration (position, ticker, label) VALUES (?, ?, ?)",
            [(r[0], r[1], r[2]) for r in old_rows],
        )


# ── OHLC ─────────────────────────────────────────────────────────────────────

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


# ── Watchlist ─────────────────────────────────────────────────────────────────

def get_watchlist(user_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ticker, label FROM watchlist WHERE user_id = ? ORDER BY position",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def save_watchlist(user_id: int, symbols: list[dict]):
    """Replace the entire watchlist for a user."""
    with _connect() as conn:
        conn.execute("DELETE FROM watchlist WHERE user_id = ?", (user_id,))
        conn.executemany(
            "INSERT INTO watchlist (user_id, position, ticker, label) VALUES (?, ?, ?, ?)",
            [(user_id, i, s["ticker"], s["label"]) for i, s in enumerate(symbols)],
        )


def migrate_watchlist_to_user(user_id: int) -> int:
    """Assign orphaned pre-migration watchlist rows to a user. Returns count migrated."""
    with _connect() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "watchlist_migration" not in tables:
            return 0
        rows = conn.execute(
            "SELECT position, ticker, label FROM watchlist_migration ORDER BY position"
        ).fetchall()
        if rows:
            conn.executemany(
                "INSERT OR IGNORE INTO watchlist (user_id, position, ticker, label) VALUES (?, ?, ?, ?)",
                [(user_id, r[0], r[1], r[2]) for r in rows],
            )
        conn.execute("DROP TABLE IF EXISTS watchlist_migration")
    return len(rows)


# ── Users ─────────────────────────────────────────────────────────────────────

def get_user_by_id(user_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_user_by_username(username: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
    return dict(row) if row else None


def create_user(username: str, password_hash: str, is_admin: bool = False) -> int:
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        result = conn.execute(
            "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, int(is_admin), now),
        )
    return result.lastrowid


# ── Invite tokens ─────────────────────────────────────────────────────────────

def create_invite_token(token: str, created_by: int):
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        conn.execute(
            "INSERT INTO invite_tokens (token, created_by, created_at) VALUES (?, ?, ?)",
            (token, created_by, now),
        )


def get_invite_token(token: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM invite_tokens WHERE token = ?", (token,)
        ).fetchone()
    return dict(row) if row else None


def consume_invite_token(token: str, used_by: int) -> bool:
    """Mark token as used. Returns False if already used or not found."""
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        row = conn.execute(
            "SELECT used_by FROM invite_tokens WHERE token = ?", (token,)
        ).fetchone()
        if not row or row[0] is not None:
            return False
        conn.execute(
            "UPDATE invite_tokens SET used_by = ?, used_at = ? WHERE token = ?",
            (used_by, now, token),
        )
    return True


# ── Preferences ───────────────────────────────────────────────────────────────

def get_preferences(user_id: int) -> dict:
    with _connect() as conn:
        row = conn.execute(
            "SELECT ticker, interval, date FROM preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else {}


def set_preferences(user_id: int, ticker: str | None, interval: str | None, date: str | None):
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO preferences (user_id, ticker, interval, date) VALUES (?, ?, ?, ?)",
            (user_id, ticker, interval, date),
        )
