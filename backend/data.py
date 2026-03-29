"""Yahoo Finance OHLC fetching with SQLite caching."""

import logging
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

# 5m/15m: absolute limit — start must be >= now - N days (Yahoo Finance hard cutoff)
ABSOLUTE_LIMITS: dict[str, int] = {"5m": 59, "15m": 59}
# 1h/4h: span limit — (end - start) must be <= N days
SPAN_LIMITS: dict[str, int] = {"1h": 729, "4h": 729}


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
        error = data.get("chart", {}).get("error") or {}
        code = error.get("code", "Unknown")
        if code == "Not Found":
            raise SymbolNotFoundError(f"{symbol} was not found on Yahoo Finance")
        raise DataUnavailableError(f"No data available for {symbol}")

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


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Remove clearly bad bars (futures rollover artifacts, bad ticks)."""
    if df.empty:
        return df
    # Drop bars with non-positive prices or inverted high/low
    df = df[(df["Low"] > 0) & (df["High"] >= df["Low"])]
    if df.empty:
        return df
    # Drop bars where the close is more than 60% away from the median close
    # (catches near-zero spikes without hardcoding price levels)
    median = df["Close"].median()
    df = df[(df["Low"] >= median * 0.4) & (df["High"] <= median * 2.5)]
    return df


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


def _clamp_start(interval: str, requested_start: datetime, fetch_end: datetime) -> datetime:
    """Clamp start to Yahoo Finance's data availability limits.

    5m/15m use an absolute cutoff (now - N days).
    1h/4h use a span limit (end - start <= N days).
    Raises DataUnavailableError when the entire requested range is out of bounds.
    """
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

    unavailable_err = None
    if need_fetch:
        try:
            fetch_start = _clamp_start(interval, fetch_start, fetch_end + timedelta(days=1))
        except DataUnavailableError as e:
            # Yahoo can't provide this range — skip the fetch and try the cache.
            # If the cache has data we'll return it; otherwise we'll surface the error below.
            unavailable_err = e
        else:
            logger.info(f"Fetching {symbol} {interval} from {fetch_start} to {fetch_end}")
            try:
                df = _yf_fetch(symbol, yf_interval, fetch_start, fetch_end + timedelta(days=1))
                if not df.empty and resample_rule:
                    df = _resample(df, resample_rule)
                if not df.empty:
                    bars_to_cache = _df_to_bars(df)
                    cache.upsert_bars(symbol, interval, bars_to_cache)

                    new_from = min(start_ts, meta["fetched_from"] if meta else start_ts)
                    new_to = max(end_ts, meta["fetched_to"] if meta else end_ts)
                    cache.set_fetch_meta(symbol, interval, new_from, new_to)
            except (SymbolNotFoundError, DataUnavailableError):
                raise
            except Exception as e:
                logger.warning(f"Fetch failed for {symbol} {interval}: {e}")

    cached = cache.get_cached_bars(symbol, interval, start_ts, end_ts)
    if not cached and unavailable_err:
        raise unavailable_err
    return cached
