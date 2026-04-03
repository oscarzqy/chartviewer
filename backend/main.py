"""ChartViewer FastAPI backend."""

import asyncio
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

import auth
import cache
import data
import archiver
import os
from concurrent.futures import ThreadPoolExecutor
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(archiver.run_archiver())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="ChartViewer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_INTERVALS = {"5m", "15m", "1h", "4h", "1d", "1wk", "1mo", "1y"}

DEFAULT_WATCHLIST = [
    {"ticker": "GC=F",     "label": "XAU/USD"},
    {"ticker": "EURUSD=X", "label": "EUR/USD"},
    {"ticker": "GBPUSD=X", "label": "GBP/USD"},
    {"ticker": "USDJPY=X", "label": "USD/JPY"},
    {"ticker": "USDCHF=X", "label": "USD/CHF"},
    {"ticker": "AUDUSD=X", "label": "AUD/USD"},
    {"ticker": "USDCAD=X", "label": "USD/CAD"},
]

cache.init_db()
auth.bootstrap_admin(DEFAULT_WATCHLIST)

CurrentUser = Annotated[dict, Depends(auth.get_current_user)]
AdminUser = Annotated[dict, Depends(auth.get_admin_user)]


# ── Request / response models ─────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    invite_token: str


class WatchlistSymbol(BaseModel):
    ticker: str
    label: str


class WatchlistPayload(BaseModel):
    symbols: list[WatchlistSymbol]


class PreferencesPayload(BaseModel):
    ticker: str | None = None
    interval: str | None = None
    date: str | None = None
    active_layout_id: int | None = None


class LayoutCreate(BaseModel):
    name: str


class LayoutUpdate(BaseModel):
    name: str | None = None
    drawings: str | None = None  # JSON string


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/login")
def login(req: LoginRequest):
    user = cache.get_user_by_username(req.username)
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    return {"access_token": auth.create_token(user["id"], user["username"])}


INVITE_EXPIRY_DAYS = 15


@app.post("/auth/register")
def register(req: RegisterRequest):
    token_row = cache.get_invite_token(req.invite_token)
    if not token_row:
        raise HTTPException(400, "Invalid invite code")
    if token_row["used_by"] is not None:
        raise HTTPException(400, "Invite code already used")
    age_days = (datetime.now(timezone.utc).timestamp() - token_row["created_at"]) / 86400
    if age_days > INVITE_EXPIRY_DAYS:
        raise HTTPException(400, f"Invite code expired (valid for {INVITE_EXPIRY_DAYS} days)")
    if cache.get_user_by_username(req.username):
        raise HTTPException(400, "Username already taken")
    password_hash = auth.hash_password(req.password)
    user_id = cache.create_user(req.username, password_hash)
    cache.consume_invite_token(req.invite_token, user_id)
    return {"access_token": auth.create_token(user_id, req.username)}


@app.post("/auth/invite")
def create_invite(user: AdminUser):
    token = secrets.token_urlsafe(16)
    cache.create_invite_token(token, user["id"])
    return {"token": token}


@app.get("/auth/me")
def me(user: CurrentUser):
    return {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"])}


# ── API routes ────────────────────────────────────────────────────────────────

@app.get("/api/ohlc")
def get_ohlc(
    user: CurrentUser,
    symbol: str = Query(..., description="Yahoo Finance ticker, e.g. EURUSD=X"),
    interval: str = Query(..., description="Candle size: 5m 15m 1h 4h 1d 1wk 1mo 1y"),
    start: str = Query(..., description="ISO date or datetime, e.g. 2023-01-01"),
    end: str = Query(..., description="ISO date or datetime, e.g. 2024-01-01"),
):
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"Invalid interval. Choose from: {sorted(VALID_INTERVALS)}")

    try:
        start_dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
        end_dt = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use ISO 8601 (e.g. 2023-01-01).")

    if start_dt >= end_dt:
        raise HTTPException(400, "start must be before end.")

    sym = symbol.upper()
    try:
        bars = data.get_ohlc(sym, interval, start_dt, end_dt)
    except data.SymbolNotFoundError as e:
        raise HTTPException(404, str(e))
    except data.DataUnavailableError as e:
        raise HTTPException(400, str(e))
    return {"symbol": sym, "interval": interval, "bars": bars}


@app.get("/api/ohlc/range")
def get_ohlc_range(
    _user: CurrentUser,
    symbol: str = Query(...),
    interval: str = Query(...),
):
    """Return the earliest and latest cached timestamps for a symbol+interval."""
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"Invalid interval. Choose from: {sorted(VALID_INTERVALS)}")
    meta = cache.get_fetch_meta(symbol.upper(), interval)
    if not meta:
        raise HTTPException(404, "No cached data for this symbol/interval")
    return {"earliest_ts": meta["fetched_from"], "latest_ts": meta["fetched_to"]}


@app.get("/api/watchlist")
def get_watchlist(user: CurrentUser):
    return {"symbols": cache.get_watchlist(user["id"])}


@app.put("/api/watchlist")
def save_watchlist(payload: WatchlistPayload, user: CurrentUser):
    symbols = [s.model_dump() for s in payload.symbols]
    cache.save_watchlist(user["id"], symbols)
    return {"symbols": symbols}


@app.get("/api/preferences")
def get_preferences(user: CurrentUser):
    return cache.get_preferences(user["id"])


@app.put("/api/preferences")
def save_preferences(payload: PreferencesPayload, user: CurrentUser):
    cache.set_preferences(
        user["id"], payload.ticker, payload.interval, payload.date, payload.active_layout_id
    )
    return {
        "ticker": payload.ticker,
        "interval": payload.interval,
        "date": payload.date,
        "active_layout_id": payload.active_layout_id,
    }


@app.get("/api/layouts")
def get_layouts(user: CurrentUser):
    return {"layouts": cache.get_layouts(user["id"])}


@app.post("/api/layouts")
def create_layout(body: LayoutCreate, user: CurrentUser):
    layout_id = cache.create_layout(user["id"], body.name)
    return {"id": layout_id, "name": body.name, "drawings": "[]"}


@app.put("/api/layouts/{layout_id}")
def update_layout(layout_id: int, body: LayoutUpdate, user: CurrentUser):
    ok = cache.update_layout(layout_id, user["id"], name=body.name, drawings=body.drawings)
    if not ok:
        raise HTTPException(404, "Layout not found")
    return {"ok": True}


@app.delete("/api/layouts/{layout_id}")
def delete_layout(layout_id: int, user: CurrentUser):
    ok = cache.delete_layout(layout_id, user["id"])
    if not ok:
        raise HTTPException(404, "Layout not found")
    return {"ok": True}


@app.get("/api/search")
def search_tickers(
    user: CurrentUser,
    q: str = Query(..., min_length=1, description="Search query"),
):
    """Search for tickers across Yahoo Finance and Polygon.io in parallel."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        yf_fut = pool.submit(data.search_yahoo, q)
        pg_fut = pool.submit(data.search_polygon, q)
        results = yf_fut.result() + pg_fut.result()
    return {"results": results}


@app.get("/api/sources")
def get_sources(user: CurrentUser):
    """Return configured data sources. 'available' is False if API key is missing."""
    sources = [
        {"id": "yahoo", "name": "Yahoo Finance", "available": True},
        {
            "id": "polygon",
            "name": "Polygon.io",
            "available": bool(os.environ.get("POLYGON_API_KEY", "").strip()),
        },
    ]
    return {"sources": sources}


@app.get("/api/archiver/status")
def archiver_status(user: CurrentUser):
    """Return tracked tickers and their last backfill timestamps."""
    tracked = cache.get_tracked_tickers()
    return {
        "total": len(tracked),
        "tickers": [
            {
                "ticker": row["ticker"],
                "registered_at": row["registered_at"],
                "last_backfill": row["last_backfill"],
            }
            for row in tracked
        ],
    }


@app.get("/health")
def health():
    return {"status": "ok"}
