"""Data fetching with SQLite caching. Supports Yahoo Finance and Polygon.io."""

import logging
import os
from datetime import datetime, timezone, timedelta

import requests
import pandas as pd

import cache


class SymbolNotFoundError(Exception):
    pass


class DataUnavailableError(Exception):
    pass


_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; chartviewer/1.0)"})

logger = logging.getLogger(__name__)

CACHE_STALE_SECONDS = 30 * 60  # 30 minutes

def _polygon_api_key() -> str:
    return os.environ.get("POLYGON_API_KEY", "")

# ── Interval configs ──────────────────────────────────────────────────────────

# Yahoo Finance: (yf_interval, resample_rule or None)
YF_INTERVAL_CONFIG: dict[str, tuple[str, str | None]] = {
    "5m":  ("5m",  None),
    "15m": ("15m", None),
    "1h":  ("1h",  None),
    "4h":  ("1h",  "4h"),
    "1d":  ("1d",  None),
    "1wk": ("1wk", None),
    "1mo": ("1mo", None),
    "1y":  ("1mo", "YE"),
}

# Polygon.io: (multiplier, timespan, resample_rule or None)
# 4h is native on Polygon, no resampling needed.
POLYGON_INTERVAL_CONFIG: dict[str, tuple[int, str, str | None]] = {
    "5m":  (5,  "minute", None),
    "15m": (15, "minute", None),
    "1h":  (1,  "hour",   None),
    "4h":  (4,  "hour",   None),
    "1d":  (1,  "day",    None),
    "1wk": (1,  "week",   None),
    "1mo": (1,  "month",  None),
    "1y":  (1,  "month",  "YE"),
}

# Backward-compat alias used in tests
INTERVAL_CONFIG = YF_INTERVAL_CONFIG

# ── Yahoo: hard date-range limits ────────────────────────────────────────────

# 5m/15m: absolute cutoff — start must be >= now - N days
ABSOLUTE_LIMITS: dict[str, int] = {"5m": 59, "15m": 59}
# 1h/4h: span limit — (end - start) must be <= N days
SPAN_LIMITS: dict[str, int] = {"1h": 729, "4h": 729}


# ── Symbol parsing ────────────────────────────────────────────────────────────

def parse_symbol(symbol: str) -> tuple[str, str]:
    """Return (source, ticker). Source is 'yahoo' or 'polygon'.

    Prefix rules:
      POLYGON:<ticker>  →  polygon
      YAHOO:<ticker>    →  yahoo
      <bare>            →  yahoo  (backward compat)
    """
    if symbol.startswith("POLYGON:"):
        return "polygon", symbol[len("POLYGON:"):]
    if symbol.startswith("YAHOO:"):
        return "yahoo", symbol[len("YAHOO:"):]
    return "yahoo", symbol


# ── Yahoo fetching ────────────────────────────────────────────────────────────

def _yf_fetch(ticker: str, yf_interval: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch OHLC from Yahoo Finance v8 API. Returns df indexed by UTC datetime."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {
        "interval": yf_interval,
        "period1": int(start.timestamp()),
        "period2": int(end.timestamp()),
        "includePrePost": "false",
    }
    resp = _session.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    result = data.get("chart", {}).get("result")
    if not result:
        error = data.get("chart", {}).get("error") or {}
        code = error.get("code", "Unknown")
        if code == "Not Found":
            raise SymbolNotFoundError(f"{ticker} was not found on Yahoo Finance")
        raise DataUnavailableError(f"No data available for {ticker}")

    result = result[0]
    timestamps = result.get("timestamp", [])
    ohlc = result.get("indicators", {}).get("quote", [{}])[0]

    if not timestamps or not ohlc.get("open"):
        return pd.DataFrame()

    df = pd.DataFrame({
        "Open":  ohlc["open"],
        "High":  ohlc["high"],
        "Low":   ohlc["low"],
        "Close": ohlc["close"],
    }, index=pd.to_datetime(timestamps, unit="s", utc=True))

    return _clean(df.dropna())


def _clamp_start(interval: str, requested_start: datetime, fetch_end: datetime) -> datetime:
    """Clamp start to Yahoo Finance's data availability limits."""
    if interval in ABSOLUTE_LIMITS:
        earliest = datetime.now(timezone.utc) - timedelta(days=ABSOLUTE_LIMITS[interval])
        if fetch_end <= earliest:
            raise DataUnavailableError(
                f"{interval} data is only available for the last {ABSOLUTE_LIMITS[interval]} days. "
                f"Switch to 1h or a longer interval to view this date."
            )
        if requested_start < earliest:
            return earliest
    elif interval in SPAN_LIMITS:
        limit = fetch_end - timedelta(days=SPAN_LIMITS[interval] - 1)
        if requested_start < limit:
            return limit
    return requested_start


# ── Polygon.io fetching ───────────────────────────────────────────────────────

def _polygon_fetch(ticker: str, interval: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch OHLC from Polygon.io REST API. Returns df indexed by UTC datetime."""
    if not _polygon_api_key():
        raise DataUnavailableError(
            "Polygon.io API key not configured. Add POLYGON_API_KEY to backend/.env"
        )

    multiplier, timespan, _ = POLYGON_INTERVAL_CONFIG[interval]
    from_str = start.strftime("%Y-%m-%d")
    to_str = end.strftime("%Y-%m-%d")

    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker}"
        f"/range/{multiplier}/{timespan}/{from_str}/{to_str}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 5000,
        "apiKey": _polygon_api_key(),
    }

    all_results: list[dict] = []
    current_url: str | None = url
    first = True

    while current_url:
        if first:
            resp = _session.get(current_url, params=params, timeout=15)
            first = False
        else:
            resp = _session.get(current_url, timeout=15)
        resp.raise_for_status()
        body = resp.json()

        status = body.get("status", "")
        if status == "ERROR":
            raise DataUnavailableError(
                f"Polygon.io error for {ticker}: {body.get('error', 'unknown error')}"
            )
        if status == "NOT_FOUND":
            raise SymbolNotFoundError(f"{ticker} was not found on Polygon.io")

        results = body.get("results") or []
        all_results.extend(results)

        next_url = body.get("next_url")
        current_url = f"{next_url}&apiKey={_polygon_api_key()}" if next_url else None

    if not all_results:
        raise DataUnavailableError(
            f"No data available for {ticker} from Polygon.io in the requested date range"
        )

    df = pd.DataFrame({
        "Open":  [r["o"] for r in all_results],
        "High":  [r["h"] for r in all_results],
        "Low":   [r["l"] for r in all_results],
        "Close": [r["c"] for r in all_results],
    }, index=pd.to_datetime([r["t"] for r in all_results], unit="ms", utc=True))

    return _clean(df.dropna())


# ── Shared helpers ────────────────────────────────────────────────────────────

def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Remove clearly bad bars (bad ticks, inverted high/low)."""
    if df.empty:
        return df
    df = df[(df["Low"] > 0) & (df["High"] >= df["Low"])]
    if df.empty:
        return df
    median = df["Close"].median()
    df = df[(df["Low"] >= median * 0.4) & (df["High"] <= median * 2.5)]
    return df


def _resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    return df.resample(rule).agg(
        Open=("Open", "first"),
        High=("High", "max"),
        Low=("Low", "min"),
        Close=("Close", "last"),
    ).dropna()


def _df_to_bars(df: pd.DataFrame) -> list[dict]:
    bars = []
    for ts, row in df.iterrows():
        bars.append({
            "ts": int(ts.timestamp()),
            "open": round(float(row["Open"]), 6),
            "high": round(float(row["High"]), 6),
            "low": round(float(row["Low"]), 6),
            "close": round(float(row["Close"]), 6),
        })
    return bars


# ── Search ───────────────────────────────────────────────────────────────────

def search_yahoo(query: str, limit: int = 8) -> list[dict]:
    """Search Yahoo Finance for tickers matching query."""
    url = "https://query1.finance.yahoo.com/v1/finance/search"
    params = {"q": query, "quotesCount": limit, "newsCount": 0, "enableFuzzyQuery": False}
    try:
        resp = _session.get(url, params=params, timeout=8)
        resp.raise_for_status()
        body = resp.json()
        results = []
        for q in body.get("quotes", []):
            symbol = q.get("symbol", "")
            if not symbol:
                continue
            results.append({
                "ticker": symbol,
                "label": q.get("shortname") or q.get("longname") or symbol,
                "type": q.get("quoteType", "").lower(),
                "exchange": q.get("exchange", ""),
                "source": "yahoo",
            })
        return results
    except Exception as e:
        logger.warning(f"Yahoo search failed for '{query}': {e}")
        return []


def search_polygon(query: str, limit: int = 8) -> list[dict]:
    """Search Polygon.io for tickers matching query."""
    if not _polygon_api_key():
        return []
    url = "https://api.polygon.io/v3/reference/tickers"
    params = {"search": query, "active": "true", "limit": limit, "apiKey": _polygon_api_key()}
    try:
        resp = _session.get(url, params=params, timeout=8)
        resp.raise_for_status()
        body = resp.json()
        results = []
        for t in body.get("results", []):
            raw_ticker = t.get("ticker", "")
            if not raw_ticker:
                continue
            results.append({
                "ticker": f"POLYGON:{raw_ticker}",
                "label": t.get("name") or raw_ticker,
                "type": t.get("type", "").lower(),
                "exchange": t.get("primary_exchange") or t.get("market", ""),
                "source": "polygon",
            })
        return results
    except Exception as e:
        logger.warning(f"Polygon search failed for '{query}': {e}")
        return []


# ── Main entry point ──────────────────────────────────────────────────────────

def get_ohlc(symbol: str, interval: str, start: datetime, end: datetime) -> list[dict]:
    """Return OHLC bars for (symbol, interval) between start and end.

    symbol may be a bare Yahoo ticker (e.g. 'GC=F') or source-prefixed
    (e.g. 'POLYGON:C:XAUUSD'). Cache key is always the full symbol string.

    Polygon errors are raised immediately (no cache fallback).
    Yahoo clamp errors fall back to cache if data exists.
    """
    if interval not in YF_INTERVAL_CONFIG:
        raise ValueError(f"Unknown interval: {interval}")

    source, ticker = parse_symbol(symbol)
    start_ts = int(start.timestamp())
    end_ts = int(end.timestamp())

    meta = cache.get_fetch_meta(symbol, interval)
    stale_seconds = cache.seconds_since_last_update(symbol, interval)

    need_fetch = False
    fetch_start = start
    fetch_end = end

    if meta is None:
        need_fetch = True
    else:
        if start_ts < meta["fetched_from"]:
            need_fetch = True
            fetch_end = datetime.fromtimestamp(meta["fetched_from"], tz=timezone.utc)

        if stale_seconds is not None and stale_seconds > CACHE_STALE_SECONDS:
            need_fetch = True
            recent_start = datetime.now(timezone.utc) - timedelta(days=5)
            if recent_start < fetch_start:
                fetch_start = recent_start
            fetch_end = end

        if end_ts > meta["fetched_to"]:
            need_fetch = True
            fetch_end = end

    unavailable_err = None
    if need_fetch:
        logger.info(f"Fetching {symbol} {interval} from {fetch_start} to {fetch_end}")

        if source == "polygon":
            _, _, resample_rule = POLYGON_INTERVAL_CONFIG[interval]
            try:
                df = _polygon_fetch(ticker, interval, fetch_start, fetch_end + timedelta(days=1))
            except (SymbolNotFoundError, DataUnavailableError):
                raise  # No cache fallback for Polygon
            except Exception as e:
                logger.warning(f"Fetch failed for {symbol} {interval}: {e}")
                df = pd.DataFrame()
        else:
            resample_rule = None
            df = pd.DataFrame()
            try:
                fetch_start = _clamp_start(interval, fetch_start, fetch_end + timedelta(days=1))
            except DataUnavailableError as e:
                unavailable_err = e
            else:
                yf_interval, resample_rule = YF_INTERVAL_CONFIG[interval]
                try:
                    df = _yf_fetch(ticker, yf_interval, fetch_start, fetch_end + timedelta(days=1))
                except (SymbolNotFoundError, DataUnavailableError):
                    raise
                except Exception as e:
                    logger.warning(f"Fetch failed for {symbol} {interval}: {e}")

        if not df.empty:
            if resample_rule:
                df = _resample(df, resample_rule)
            if not df.empty:
                cache.upsert_bars(symbol, interval, _df_to_bars(df))
                new_from = min(start_ts, meta["fetched_from"] if meta else start_ts)
                new_to = max(end_ts, meta["fetched_to"] if meta else end_ts)
                cache.set_fetch_meta(symbol, interval, new_from, new_to)

    cached = cache.get_cached_bars(symbol, interval, start_ts, end_ts)
    if not cached and unavailable_err:
        raise unavailable_err
    return cached
