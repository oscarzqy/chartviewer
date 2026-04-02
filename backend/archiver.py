"""Background archiver: promotes watched tickers and backfills historical OHLC data.

Lifecycle:
  - Runs every ARCHIVER_INTERVAL_SECONDS (default 1 hour) inside an asyncio task.
  - Promotion: scans all watchlists for tickers that have been present for
    PROMOTION_THRESHOLD_HOURS (default 3h). Newly eligible tickers are added to
    the tracked_tickers table in the OHLC DB.
  - Backfill: for every tracked ticker × interval, calls data.get_ohlc() with
    the maximum historical range. The existing fetch_meta cache logic ensures
    only missing date ranges are actually fetched from the upstream API.

Polygon note: the free tier does not serve today's data, so Polygon tickers
always use yesterday as the backfill end date.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

import cache
import data

logger = logging.getLogger(__name__)

PROMOTION_THRESHOLD_HOURS = 3
ARCHIVER_INTERVAL_SECONDS = 3600  # 1 hour

# Intervals to archive → max lookback in days.
# Yahoo Finance hard limits: 5m/15m = 59 days, 1h/4h = 729 days.
# Polygon has no practical limit on daily+.
ARCHIVE_INTERVALS: dict[str, int] = {
    "5m":  59,
    "15m": 59,
    "1h":  729,
    "4h":  729,
    "1d":  365 * 10,
    "1wk": 365 * 10,
    "1mo": 365 * 20,
}


async def run_archiver():
    """Async loop: runs promotion + backfill immediately on startup, then every hour."""
    logger.info("Archiver started (interval=%ds, promotion_threshold=%dh)",
                ARCHIVER_INTERVAL_SECONDS, PROMOTION_THRESHOLD_HOURS)
    while True:
        try:
            await asyncio.to_thread(_tick)
        except Exception:
            logger.exception("Archiver tick failed")
        await asyncio.sleep(ARCHIVER_INTERVAL_SECONDS)


def _tick():
    _promote_tickers()
    _run_backfills()


def _promote_tickers():
    """Register tickers that have been on any watchlist for 3+ hours."""
    cutoff = int(
        (datetime.now(timezone.utc) - timedelta(hours=PROMOTION_THRESHOLD_HOURS)).timestamp()
    )
    candidates = cache.get_watchlist_tickers_older_than(cutoff)
    for ticker in candidates:
        if cache.register_tracked_ticker(ticker):
            logger.info("Registered ticker for archiving: %s", ticker)


def _run_backfills():
    """Pull historical OHLC data for all tracked tickers."""
    tracked = cache.get_tracked_tickers()
    if not tracked:
        return

    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)

    for row in tracked:
        ticker = row["ticker"]
        source, _ = data.parse_symbol(ticker)
        # Polygon free tier has no data for today
        end_dt = yesterday if source == "polygon" else now

        for interval, lookback_days in ARCHIVE_INTERVALS.items():
            start_dt = now - timedelta(days=lookback_days)
            try:
                bars = data.get_ohlc(ticker, interval, start_dt, end_dt)
                logger.debug("Backfilled %s %s: %d bars", ticker, interval, len(bars))
            except (data.SymbolNotFoundError, data.DataUnavailableError) as e:
                logger.warning("Backfill skipped %s %s: %s", ticker, interval, e)
            except Exception:
                logger.exception("Backfill error %s %s", ticker, interval)

        cache.update_tracked_ticker_backfill(ticker)
        logger.info("Backfill complete: %s", ticker)
