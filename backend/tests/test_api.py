"""Tests for the FastAPI endpoints."""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app

client = TestClient(app)


@pytest.fixture(autouse=True, scope="module")
def _auth_client(admin_token):
    global client
    client = TestClient(app, headers={"Authorization": f"Bearer {admin_token}"})


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


# ── Health ────────────────────────────────────────────────────────────────────

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_login_invalid_credentials():
    r = TestClient(app).post("/auth/login", json={"username": "nobody", "password": "wrong"})
    assert r.status_code == 401


def test_login_success(admin_token):
    r = TestClient(app).post("/auth/login", json={"username": "testadmin", "password": "testpass"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_me(admin_token):
    r = client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == "testadmin"
    assert r.json()["is_admin"] is True


def test_protected_route_rejects_no_token():
    r = TestClient(app).get("/api/watchlist")
    assert r.status_code == 403  # HTTPBearer returns 403 when no credentials provided


def test_protected_route_rejects_bad_token():
    r = TestClient(app).get("/api/watchlist", headers={"Authorization": "Bearer bad.token.here"})
    assert r.status_code == 401


def test_invite_create_and_register():
    # Admin creates invite
    r = client.post("/auth/invite")
    assert r.status_code == 200
    token = r.json()["token"]

    # Register new user with invite
    r = TestClient(app).post("/auth/register", json={
        "username": "newuser",
        "password": "newpass",
        "invite_token": token,
    })
    assert r.status_code == 200
    assert "access_token" in r.json()

    # Cannot reuse invite
    r = TestClient(app).post("/auth/register", json={
        "username": "anotheruser",
        "password": "pass",
        "invite_token": token,
    })
    assert r.status_code == 400


def test_invite_expired():
    import cache, time
    # Manually insert an expired token (created 16 days ago)
    expired_token = "expired-test-token-xyz"
    old_ts = int(time.time()) - 16 * 86400
    with cache._connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO invite_tokens (token, created_by, created_at) VALUES (?, 1, ?)",
            (expired_token, old_ts),
        )
    r = TestClient(app).post("/auth/register", json={
        "username": "lateuser",
        "password": "pass",
        "invite_token": expired_token,
    })
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


# ── /api/watchlist ────────────────────────────────────────────────────────────

def test_watchlist_returns_list():
    r = client.get("/api/watchlist")
    assert r.status_code == 200
    data = r.json()
    assert "symbols" in data
    assert isinstance(data["symbols"], list)
    assert len(data["symbols"]) > 0
    assert all("ticker" in s and "label" in s for s in data["symbols"])


def test_watchlist_save_and_reload():
    new_list = [{"ticker": "AAPL", "label": "Apple"}, {"ticker": "MSFT", "label": "Microsoft"}]
    r = client.put("/api/watchlist", json={"symbols": new_list})
    assert r.status_code == 200

    r = client.get("/api/watchlist")
    tickers = [s["ticker"] for s in r.json()["symbols"]]
    assert tickers == ["AAPL", "MSFT"]


# ── /api/preferences ──────────────────────────────────────────────────────────

def test_preferences_round_trip():
    r = client.put("/api/preferences", json={"ticker": "AAPL", "interval": "4h", "date": "2025-06-01"})
    assert r.status_code == 200

    r = client.get("/api/preferences")
    assert r.status_code == 200
    data = r.json()
    assert data["ticker"] == "AAPL"
    assert data["interval"] == "4h"
    assert data["date"] == "2025-06-01"


# ── /api/ohlc validation ──────────────────────────────────────────────────────

def test_ohlc_missing_params():
    r = client.get("/api/ohlc")
    assert r.status_code == 422  # FastAPI validation error


def test_ohlc_invalid_interval():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=3h&start=2025-01-01&end=2025-02-01")
    assert r.status_code == 400


@patch("data._session")
def test_ohlc_unknown_symbol_returns_404(mock_session):
    not_found_resp = MagicMock()
    not_found_resp.raise_for_status = MagicMock()
    not_found_resp.json.return_value = {
        "chart": {"result": None, "error": {"code": "Not Found", "description": "No data found"}}
    }
    mock_session.get.return_value = not_found_resp
    r = client.get("/api/ohlc?symbol=INVALID=X&interval=1h&start=2025-01-01&end=2025-02-01")
    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()


def test_ohlc_start_after_end():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=1h&start=2025-06-01&end=2025-01-01")
    assert r.status_code == 400


def test_ohlc_invalid_date_format():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=1h&start=not-a-date&end=2025-02-01")
    assert r.status_code == 400


def test_ohlc_5m_old_date_returns_400():
    """5m/15m data is only available for the last 60 days — older dates should 400."""
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=5m&start=2024-01-01&end=2024-02-01")
    assert r.status_code == 400
    assert "5m" in r.json()["detail"]


def test_ohlc_15m_old_date_returns_400():
    r = client.get("/api/ohlc?symbol=EURUSD=X&interval=15m&start=2024-01-01&end=2024-02-01")
    assert r.status_code == 400
    assert "15m" in r.json()["detail"]


# ── /api/ohlc data ────────────────────────────────────────────────────────────

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
    assert mock_session.get.call_count == call_count_after_first


# ── /api/sources ──────────────────────────────────────────────────────────────

def test_sources_returns_yahoo_and_polygon():
    r = client.get("/api/sources")
    assert r.status_code == 200
    sources = {s["id"]: s for s in r.json()["sources"]}
    assert "yahoo" in sources
    assert "polygon" in sources
    assert sources["yahoo"]["available"] is True


def test_sources_polygon_unavailable_without_key(monkeypatch):
    monkeypatch.setenv("POLYGON_API_KEY", "")
    r = client.get("/api/sources")
    assert r.status_code == 200
    sources = {s["id"]: s for s in r.json()["sources"]}
    assert sources["polygon"]["available"] is False


def test_sources_polygon_available_with_key(monkeypatch):
    monkeypatch.setenv("POLYGON_API_KEY", "test_key_123")
    r = client.get("/api/sources")
    assert r.status_code == 200
    sources = {s["id"]: s for s in r.json()["sources"]}
    assert sources["polygon"]["available"] is True


# ── Polygon symbol routing ────────────────────────────────────────────────────

def _fake_polygon_response(n_bars=5):
    base_ts = 1_740_000_000_000  # milliseconds
    return {
        "status": "OK",
        "resultsCount": n_bars,
        "results": [
            {
                "o": 2600.0 + i,
                "h": 2610.0 + i,
                "l": 2590.0 + i,
                "c": 2605.0 + i,
                "t": base_ts + i * 3_600_000,
            }
            for i in range(n_bars)
        ],
    }


def _mock_polygon_get(*args, **kwargs):
    mock = MagicMock()
    mock.raise_for_status = MagicMock()
    mock.json.return_value = _fake_polygon_response()
    return mock


@patch("data._session")
def test_ohlc_polygon_symbol_returns_bars(mock_session, monkeypatch):
    monkeypatch.setenv("POLYGON_API_KEY", "fake_key")
    mock_session.get.side_effect = _mock_polygon_get
    r = client.get("/api/ohlc?symbol=POLYGON:C:XAUUSD&interval=1h&start=2025-01-01&end=2025-03-01")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "POLYGON:C:XAUUSD"
    assert len(body["bars"]) > 0
    assert {"ts", "open", "high", "low", "close"} == set(body["bars"][0].keys())


@patch("data._session")
def test_ohlc_polygon_not_found_returns_404(mock_session, monkeypatch):
    monkeypatch.setenv("POLYGON_API_KEY", "fake_key")
    not_found = MagicMock()
    not_found.raise_for_status = MagicMock()
    not_found.json.return_value = {"status": "NOT_FOUND", "results": None}
    mock_session.get.return_value = not_found
    r = client.get("/api/ohlc?symbol=POLYGON:INVALID_XXX&interval=1h&start=2025-01-01&end=2025-03-01")
    assert r.status_code == 404


@patch("data._session")
def test_ohlc_polygon_no_key_returns_400(mock_session, monkeypatch):
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    # Use a ticker not seen in other tests so there's no cached data
    r = client.get("/api/ohlc?symbol=POLYGON:C:EURUSD_NOKEY&interval=1h&start=2025-01-01&end=2025-03-01")
    assert r.status_code == 400
    assert "API key" in r.json()["detail"]


# ── parse_symbol ──────────────────────────────────────────────────────────────

def test_parse_symbol_bare_is_yahoo():
    import data
    assert data.parse_symbol("GC=F") == ("yahoo", "GC=F")


def test_parse_symbol_yahoo_prefix():
    import data
    assert data.parse_symbol("YAHOO:GC=F") == ("yahoo", "GC=F")


def test_parse_symbol_polygon_prefix():
    import data
    assert data.parse_symbol("POLYGON:C:XAUUSD") == ("polygon", "C:XAUUSD")
