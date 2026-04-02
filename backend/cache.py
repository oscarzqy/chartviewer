"""SQLite-backed OHLC cache and user data store.

Two DB files (configurable via env vars):
  CHARTVIEWER_DB_PATH      — app data: users, watchlists, preferences, layouts
  CHARTVIEWER_OHLC_DB_PATH — price data: ohlc bars, fetch_meta, tracked_tickers

Both default to the same file (ohlc_cache.db) for backward-compatibility with
single-file deployments. Set CHARTVIEWER_OHLC_DB_PATH to a different path to
split them (recommended for cloud deployments with Litestream replication).
"""

import sqlite3
import os
from datetime import datetime, timezone

APP_DB_PATH = os.environ.get(
    "CHARTVIEWER_DB_PATH",
    os.path.join(os.path.dirname(__file__), "ohlc_cache.db"),
)

OHLC_DB_PATH = os.environ.get(
    "CHARTVIEWER_OHLC_DB_PATH",
    APP_DB_PATH,  # same file by default — backward compat
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(APP_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _connect_ohlc() -> sqlite3.Connection:
    conn = sqlite3.connect(OHLC_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    _init_app_db()
    _init_ohlc_db()


def _init_app_db():
    with _connect() as conn:
        conn.executescript("""
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

            CREATE TABLE IF NOT EXISTS layouts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                name       TEXT    NOT NULL,
                drawings   TEXT    NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)
        _migrate_watchlist(conn)
        _migrate_preferences_v2(conn)
        _migrate_watchlist_added_at(conn)


def _init_ohlc_db():
    with _connect_ohlc() as conn:
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

            CREATE TABLE IF NOT EXISTS tracked_tickers (
                ticker        TEXT    PRIMARY KEY,
                registered_at INTEGER NOT NULL,
                last_backfill INTEGER
            );
        """)


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
            added_at INTEGER NOT NULL DEFAULT 0,
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


def _migrate_watchlist_added_at(conn: sqlite3.Connection):
    """Add added_at column to watchlist if absent (existing per-user installs)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(watchlist)").fetchall()}
    if "added_at" not in cols:
        # DEFAULT 0 = epoch, so existing tickers are immediately eligible for archiving
        conn.execute("ALTER TABLE watchlist ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0")


def _migrate_preferences_v2(conn: sqlite3.Connection):
    """Add active_layout_id column to preferences if absent."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(preferences)").fetchall()}
    if "active_layout_id" not in cols:
        conn.execute("ALTER TABLE preferences ADD COLUMN active_layout_id INTEGER")


# ── OHLC ─────────────────────────────────────────────────────────────────────

def get_cached_bars(symbol: str, interval: str, start_ts: int, end_ts: int) -> list[dict]:
    with _connect_ohlc() as conn:
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
    with _connect_ohlc() as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO ohlc (symbol, interval, ts, open, high, low, close)
            VALUES (:symbol, :interval, :ts, :open, :high, :low, :close)
            """,
            [{"symbol": symbol, "interval": interval, **b} for b in bars],
        )


def get_fetch_meta(symbol: str, interval: str) -> dict | None:
    with _connect_ohlc() as conn:
        row = conn.execute(
            "SELECT * FROM fetch_meta WHERE symbol = ? AND interval = ?",
            (symbol, interval),
        ).fetchone()
    return dict(row) if row else None


def set_fetch_meta(symbol: str, interval: str, fetched_from: int, fetched_to: int):
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect_ohlc() as conn:
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


# ── Tracked tickers ───────────────────────────────────────────────────────────

def get_watchlist_tickers_older_than(threshold_ts: int) -> list[str]:
    """Return distinct tickers from all users' watchlists added before threshold_ts."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM watchlist WHERE added_at <= ?",
            (threshold_ts,),
        ).fetchall()
    return [r[0] for r in rows]


def register_tracked_ticker(ticker: str) -> bool:
    """Add ticker to tracked list. Returns True if newly registered."""
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect_ohlc() as conn:
        result = conn.execute(
            "INSERT OR IGNORE INTO tracked_tickers (ticker, registered_at) VALUES (?, ?)",
            (ticker, now),
        )
    return result.rowcount > 0


def get_tracked_tickers() -> list[dict]:
    with _connect_ohlc() as conn:
        rows = conn.execute(
            "SELECT ticker, registered_at, last_backfill FROM tracked_tickers ORDER BY ticker"
        ).fetchall()
    return [dict(r) for r in rows]


def update_tracked_ticker_backfill(ticker: str):
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect_ohlc() as conn:
        conn.execute(
            "UPDATE tracked_tickers SET last_backfill = ? WHERE ticker = ?",
            (now, ticker),
        )


# ── Watchlist ─────────────────────────────────────────────────────────────────

def get_watchlist(user_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ticker, label FROM watchlist WHERE user_id = ? ORDER BY position",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def save_watchlist(user_id: int, symbols: list[dict]):
    """Replace the entire watchlist for a user, preserving added_at for existing tickers."""
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        existing_added_at = {
            r[0]: r[1]
            for r in conn.execute(
                "SELECT ticker, added_at FROM watchlist WHERE user_id = ?", (user_id,)
            ).fetchall()
        }
        conn.execute("DELETE FROM watchlist WHERE user_id = ?", (user_id,))
        conn.executemany(
            "INSERT INTO watchlist (user_id, position, ticker, label, added_at) VALUES (?, ?, ?, ?, ?)",
            [
                (user_id, i, s["ticker"], s["label"], existing_added_at.get(s["ticker"], now))
                for i, s in enumerate(symbols)
            ],
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
                "INSERT OR IGNORE INTO watchlist (user_id, position, ticker, label, added_at) VALUES (?, ?, ?, ?, 0)",
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
            "SELECT ticker, interval, date, active_layout_id FROM preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else {}


def set_preferences(
    user_id: int,
    ticker: str | None,
    interval: str | None,
    date: str | None,
    active_layout_id: int | None = None,
):
    with _connect() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO preferences (user_id, ticker, interval, date, active_layout_id)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, ticker, interval, date, active_layout_id),
        )


# ── Layouts ───────────────────────────────────────────────────────────────────

def get_layouts(user_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, drawings, created_at, updated_at FROM layouts WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def create_layout(user_id: int, name: str) -> int:
    now = int(datetime.now(timezone.utc).timestamp())
    with _connect() as conn:
        result = conn.execute(
            "INSERT INTO layouts (user_id, name, drawings, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)",
            (user_id, name, now, now),
        )
    return result.lastrowid


def get_layout(layout_id: int, user_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, drawings FROM layouts WHERE id = ? AND user_id = ?",
            (layout_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def update_layout(
    layout_id: int,
    user_id: int,
    name: str | None = None,
    drawings: str | None = None,
) -> bool:
    now = int(datetime.now(timezone.utc).timestamp())
    updates: list[str] = []
    params: list = []
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if drawings is not None:
        updates.append("drawings = ?")
        params.append(drawings)
    if not updates:
        return True
    updates.append("updated_at = ?")
    params.extend([now, layout_id, user_id])
    with _connect() as conn:
        result = conn.execute(
            f"UPDATE layouts SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
            params,
        )
    return result.rowcount > 0


def delete_layout(layout_id: int, user_id: int) -> bool:
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM layouts WHERE id = ? AND user_id = ?",
            (layout_id, user_id),
        )
    return result.rowcount > 0
