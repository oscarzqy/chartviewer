"""ChartViewer FastAPI backend."""

from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import cache
import data

app = FastAPI(title="ChartViewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

cache.init_db()

VALID_INTERVALS = {"5m", "15m", "1h", "4h", "1d", "1wk", "1mo", "1y"}

DEFAULT_WATCHLIST = [
    {"ticker": "GC=F",    "label": "XAU/USD"},
    {"ticker": "EURUSD=X","label": "EUR/USD"},
    {"ticker": "GBPUSD=X","label": "GBP/USD"},
    {"ticker": "USDJPY=X","label": "USD/JPY"},
    {"ticker": "USDCHF=X","label": "USD/CHF"},
    {"ticker": "AUDUSD=X","label": "AUD/USD"},
    {"ticker": "USDCAD=X","label": "USD/CAD"},
]


class WatchlistSymbol(BaseModel):
    ticker: str
    label: str


class WatchlistPayload(BaseModel):
    symbols: list[WatchlistSymbol]


@app.get("/api/ohlc")
def get_ohlc(
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


@app.get("/api/watchlist")
def get_watchlist():
    symbols = cache.get_watchlist()
    if not symbols:
        # First run: seed with defaults and persist them
        cache.save_watchlist(DEFAULT_WATCHLIST)
        symbols = DEFAULT_WATCHLIST
    return {"symbols": symbols}


@app.put("/api/watchlist")
def save_watchlist(payload: WatchlistPayload):
    symbols = [s.model_dump() for s in payload.symbols]
    cache.save_watchlist(symbols)
    return {"symbols": symbols}


@app.get("/health")
def health():
    return {"status": "ok"}
