# ChartViewer

TradingView-like OHLC chart viewer. FastAPI backend + React (Vite) + TradingView Lightweight Charts.

## Stack
- **Backend**: FastAPI, SQLite cache, Yahoo Finance v8 API (direct HTTP, not yfinance library)
- **Frontend**: React 18, Vite, lightweight-charts v4

## Running

```bash
# Terminal 1 — backend (auto-creates venv on first run)
cd backend && ./run.sh

# Terminal 2 — frontend
cd frontend && ./run.sh
```

Backend: http://localhost:8000
Frontend: http://localhost:5173 (proxies /api → backend)

## Key files
- `backend/main.py` — FastAPI app, `/api/ohlc` and `/api/symbols`
- `backend/data.py` — Yahoo Finance fetch + 4H/1Y resampling; uses `_session` (requests.Session with User-Agent)
- `backend/cache.py` — SQLite OHLC cache; DB path overridable via `CHARTVIEWER_DB_PATH` env var
- `frontend/src/api.js` — fetch helpers + `windowForInterval()` (date range per timeframe)
- `frontend/src/components/Chart.jsx` — Lightweight Charts wrapper (add indicators here as extra series)

## Intervals
| App interval | YF fetch | Resample |
|---|---|---|
| 5m, 15m, 1h | native | — |
| 4h | 1h | 4H |
| 1d, 1wk, 1mo | native | — |
| 1y | 1mo | YE |

Intraday limits: 5m/15m → 59 days back, 1h → 729 days back.

## Testing
```bash
cd backend && source .venv/bin/activate && pytest tests/ -q
```
Tests use a temp SQLite DB (via `CHARTVIEWER_DB_PATH`). Yahoo Finance HTTP calls are mocked.

## Hooks (auto-configured in .claude/settings.local.json)
- **Stop**: runs `pytest tests/ -q` and shows summary in UI
- **PostToolUse Write|Edit**: runs `ruff check` on any `.py` file just written

## v1 scope / future work
- Indicators: add as extra `chart.addLineSeries()` in `Chart.jsx`; data computed in `data.py` or client-side
- Drawing tools: Lightweight Charts has a plugin ecosystem for this
- Auth: not needed (personal tool)
