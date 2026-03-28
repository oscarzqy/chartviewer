"""Yahoo Finance OHLC fetching with SQLite caching."""

import logging
from datetime import datetime, timezone, timedelta

import requests
import pandas as pd

import cache

_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; chartviewer/1.0)"})

logger = logging.getLogger(__name__)

CACHE_STALE_SECONDS = 30 * 60  # 30 minutes

# Map app interval -> (yfinance interval, resample rule or None)
INTERVAL_CONFIG: dict[str, tuple[str, str | None]] = {
    "5m":  ("5m",  None),
    "15m": ("15m", None),
    "1h":  ("1h",  None),
    "4h":  ("1h",  "4h"),
    "1d":  ("1d",  None),
    "1wk": ("1wk", None),
    "1mo": ("1mo", None),
    "1y":  ("1mo", "YE"),   # resample monthly -> yearly
}

# yfinance hard limits for intraday history (days back)
INTRADAY_LIMITS: dict[str, int] = {
    "5m":  59,
    "15m": 59,
    "1h":  729,
}


def _yf_fetch(symbol: str, yf_interval: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch OHLC from Yahoo Finance v8 API. Returns df with Open/High/Low/Close indexed by UTC datetime."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
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
        error = data.get("chart", {}).get("error")
        raise ValueError(f"No data from Yahoo Finance: {error}")

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

    return df.dropna()


def _resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    resampled = df.resample(rule).agg(
        Open=("Open", "first"),
        High=("High", "max"),
        Low=("Low", "min"),
        Close=("Close", "last"),
    ).dropna()
    return resampled


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


def _clamp_start(interval: str, requested_start: datetime) -> datetime:
    """Clamp start date to yfinance intraday limits."""
    if interval in INTRADAY_LIMITS:
        limit = datetime.now(timezone.utc) - timedelta(days=INTRADAY_LIMITS[interval])
        if requested_start < limit:
            return limit
    return requested_start


def get_ohlc(symbol: str, interval: str, start: datetime, end: datetime) -> list[dict]:
    """
    Return OHLC bars for (symbol, interval) between start and end.

    Strategy:
    - If we have no cached data OR stale recent bars: re-fetch the full range.
    - Otherwise serve from cache.
    - Historical bars (before today) once cached are never re-fetched.
    """
    if interval not in INTERVAL_CONFIG:
        raise ValueError(f"Unknown interval: {interval}")

    yf_interval, resample_rule = INTERVAL_CONFIG[interval]
    start_ts = int(start.timestamp())
    end_ts = int(end.timestamp())

    meta = cache.get_fetch_meta(symbol, interval)
    stale_seconds = cache.seconds_since_last_update(symbol, interval)

    need_fetch = False
    fetch_start = start
    fetch_end = end

    if meta is None:
        # Never fetched
        need_fetch = True
    else:
        cached_from = meta["fetched_from"]
        cached_to = meta["fetched_to"]

        # Need earlier data than cached
        if start_ts < cached_from:
            need_fetch = True
            fetch_start = start
            fetch_end = datetime.fromtimestamp(cached_from, tz=timezone.utc)

        # Recent bars might be stale
        if stale_seconds is not None and stale_seconds > CACHE_STALE_SECONDS:
            need_fetch = True
            recent_start = datetime.now(timezone.utc) - timedelta(days=5)
            if recent_start < fetch_start:
                fetch_start = recent_start
            fetch_end = end

        # Need later data than cached
        if end_ts > cached_to:
            need_fetch = True
            fetch_end = end

    if need_fetch:
        fetch_start = _clamp_start(interval, fetch_start)
        logger.info(f"Fetching {symbol} {interval} from {fetch_start} to {fetch_end}")
        try:
            df = _yf_fetch(symbol, yf_interval, fetch_start, fetch_end + timedelta(days=1))
            if not df.empty and resample_rule:
                df = _resample(df, resample_rule)
            if not df.empty:
                bars = _df_to_bars(df)
                cache.upsert_bars(symbol, interval, bars)

                new_from = min(start_ts, meta["fetched_from"] if meta else start_ts)
                new_to = max(end_ts, meta["fetched_to"] if meta else end_ts)
                cache.set_fetch_meta(symbol, interval, new_from, new_to)
        except Exception as e:
            logger.warning(f"yfinance fetch failed for {symbol} {interval}: {e}")

    return cache.get_cached_bars(symbol, interval, start_ts, end_ts)
