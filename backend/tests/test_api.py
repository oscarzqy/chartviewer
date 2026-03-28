"""Tests for the FastAPI endpoints."""

import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app

client = TestClient(app)

# Fake Yahoo Finance response payload
def _fake_yf_response(n_bars=5):
    base_ts = 1_740_000_000
    return {
        "chart": {
            "result": [{
                "meta": {"currency": "USD", "symbol": "EURUSD=X"},
                "timestamp": [base_ts + i * 3600 for i in range(n_bars)],
                "indicators": {
                    "quote": [{
                        "open":  [1.10 + i * 0.001 for i in range(n_bars)],
                        "high":  [1.12 + i * 0.001 for i in range(n_bars)],
                        "low":   [1.09 + i * 0.001 for i in range(n_bars)],
                        "close": [1.11 + i * 0.001 for i in range(n_bars)],
                    }]
                },
            }],
            "error": None,
        }
    }


def _mock_get(*args, **kwargs):
    mock = MagicMock()
    mock.raise_for_status = MagicMock()
    mock.json.return_value = _fake_yf_response()
    return mock


# ── Health ──────────────────────────────────────────────────────────────────

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── /api/symbols ─────────────────────────────────────────────────────────────

def test_symbols_returns_list():
    r = client.get("/api/symbols")
    assert r.status_code == 200
    data = r.json()
    assert "symbols" in data
    assert len(data["symbols"]) > 0
    assert all("ticker" in s and "label" in s for s in data["symbols"])


# ── /api/ohlc validation ─────────────────────────────────────────────────────

def test_ohlc_missing_params():
    r = client.get("/api/ohlc")
    assert r.status_code == 422  # FastAPI validation error


def test_ohlc_invalid_interval():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=3h&start=2025-01-01&end=2025-02-01")
    assert r.status_code == 400


def test_ohlc_start_after_end():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=1h&start=2025-06-01&end=2025-01-01")
    assert r.status_code == 400


def test_ohlc_invalid_date_format():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=1h&start=not-a-date&end=2025-02-01")
    assert r.status_code == 400


# ── /api/ohlc data ───────────────────────────────────────────────────────────

@patch("data._session")
def test_ohlc_returns_bars(mock_session):
    mock_session.get.side_effect = _mock_get
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=1h&start=2025-01-01&end=2025-03-01")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "EURUSD=X"
    assert body["interval"] == "1h"
    assert isinstance(body["bars"], list)
    assert len(body["bars"]) > 0
    bar = body["bars"][0]
    assert {"ts", "open", "high", "low", "close"} == set(bar.keys())


@patch("data._session")
def test_ohlc_symbol_uppercased(mock_session):
    mock_session.get.side_effect = _mock_get
    r = client.get("/api/ohlc?symbol=eurusd=x&interval=1h&start=2025-01-01&end=2025-03-01")
    assert r.status_code == 200
    assert r.json()["symbol"] == "EURUSD=X"


@patch("data._session")
def test_ohlc_cached_on_second_call(mock_session):
    """Second call for same range should hit cache, not make a new HTTP call."""
    mock_session.get.side_effect = _mock_get
    url = "/api/ohlc?symbol=GBPUSD=X&interval=1d&start=2024-01-01&end=2024-06-01"
    client.get(url)
    call_count_after_first = mock_session.get.call_count

    client.get(url)
    # Second call should not increase the HTTP call count
    assert mock_session.get.call_count == call_count_after_first
