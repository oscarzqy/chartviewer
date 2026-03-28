"""Tests for the SQLite cache layer."""

import time
import pytest
import cache


SYMBOL = "TEST=X"
INTERVAL = "1h"

SAMPLE_BARS = [
    {"ts": 1_700_000_000 + i * 3600, "open": 1.1 + i * 0.01, "high": 1.2, "low": 1.0, "close": 1.15}
    for i in range(10)
]


def test_upsert_and_get_bars():
    cache.upsert_bars(SYMBOL, INTERVAL, SAMPLE_BARS)
    result = cache.get_cached_bars(SYMBOL, INTERVAL, SAMPLE_BARS[0]["ts"], SAMPLE_BARS[-1]["ts"])
    assert len(result) == len(SAMPLE_BARS)
    assert result[0]["ts"] == SAMPLE_BARS[0]["ts"]
    assert result[0]["open"] == pytest.approx(SAMPLE_BARS[0]["open"])


def test_bars_ordered_by_timestamp():
    result = cache.get_cached_bars(SYMBOL, INTERVAL, SAMPLE_BARS[0]["ts"], SAMPLE_BARS[-1]["ts"])
    timestamps = [b["ts"] for b in result]
    assert timestamps == sorted(timestamps)


def test_get_bars_range_filter():
    mid = SAMPLE_BARS[4]["ts"]
    end = SAMPLE_BARS[7]["ts"]
    result = cache.get_cached_bars(SYMBOL, INTERVAL, mid, end)
    assert all(mid <= b["ts"] <= end for b in result)


def test_upsert_is_idempotent():
    cache.upsert_bars(SYMBOL, INTERVAL, SAMPLE_BARS)
    cache.upsert_bars(SYMBOL, INTERVAL, SAMPLE_BARS)
    result = cache.get_cached_bars(SYMBOL, INTERVAL, SAMPLE_BARS[0]["ts"], SAMPLE_BARS[-1]["ts"])
    assert len(result) == len(SAMPLE_BARS)


def test_fetch_meta_round_trip():
    cache.set_fetch_meta(SYMBOL, INTERVAL, 1_000_000, 2_000_000)
    meta = cache.get_fetch_meta(SYMBOL, INTERVAL)
    assert meta is not None
    assert meta["fetched_from"] == 1_000_000
    assert meta["fetched_to"] == 2_000_000


def test_seconds_since_last_update_is_small():
    cache.set_fetch_meta(SYMBOL, INTERVAL, 1_000_000, 2_000_000)
    elapsed = cache.seconds_since_last_update(SYMBOL, INTERVAL)
    assert elapsed is not None
    assert 0 <= elapsed < 5  # should be nearly instantaneous


def test_no_meta_returns_none():
    elapsed = cache.seconds_since_last_update("NONEXISTENT=X", "1d")
    assert elapsed is None


def test_empty_range_returns_empty():
    result = cache.get_cached_bars(SYMBOL, INTERVAL, 0, 1)
    assert result == []
