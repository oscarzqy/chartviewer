import { useState, useEffect, useCallback, useRef } from 'react'
import Chart from './components/Chart.jsx'
import Toolbar from './components/Toolbar.jsx'
import TickerList from './components/TickerList.jsx'
import Toast from './components/Toast.jsx'
import AuthPage from './components/AuthPage.jsx'
import InviteButton from './components/InviteButton.jsx'
import DrawingToolbar from './components/DrawingToolbar.jsx'
import LayoutManager from './components/LayoutManager.jsx'
import { DEFAULT_FIB_LEVELS } from './components/DrawingCanvas.jsx'
import {
  fetchOHLC,
  fetchOHLCRange,
  barDurationSeconds,
  fetchWatchlist,
  saveWatchlist,
  fetchPreferences,
  savePreferences,
  fetchMe,
  windowForInterval,
  fetchLayouts,
  createLayout,
  updateLayout,
  deleteLayout,
} from './api.js'
import ReplayControls from './components/ReplayControls.jsx'

const today = () => new Date().toISOString().slice(0, 10)

// Default fib levels persisted per layout
const DEFAULT_LAYOUT_NAME = 'Default'

export default function App() {
  const [token, setToken]           = useState(() => localStorage.getItem('cv_token'))
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)

  const [tickers, setTickers]         = useState([])
  const [activeTicker, setActiveTicker] = useState(null)
  const [interval, setInterval]       = useState('1h')
  const [date, setDate]               = useState(today())
  const [bars, setBars]               = useState(null)
  const [chartCenter, setChartCenter] = useState(today())
  const [chartError, setChartError]   = useState(null)
  const [loading, setLoading]         = useState(false)
  const [toast, setToast]             = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // ── Replay state ───────────────────────────────────────────────────────────
  const [replayMode,  setReplayMode]  = useState('idle')  // 'idle'|'cut'|'playing'|'paused'
  const [replayBars,  setReplayBars]  = useState(null)
  const [replayIndex, setReplayIndex] = useState(null)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const replayTimerRef  = useRef(null)
  const replayBarsRef   = useRef(null)
  const replayIndexRef  = useRef(null)

  useEffect(() => { replayBarsRef.current  = replayBars  }, [replayBars])
  useEffect(() => { replayIndexRef.current = replayIndex }, [replayIndex])

  // Clean up timer on unmount
  useEffect(() => () => window.clearInterval(replayTimerRef.current), [])

  // ── Drawing state ──────────────────────────────────────────────────────────
  const [drawingTool, setDrawingTool] = useState('cursor')
  const [fibLevels, setFibLevels]     = useState(DEFAULT_FIB_LEVELS)  // eslint-disable-line no-unused-vars

  // ── Layout state ───────────────────────────────────────────────────────────
  const [layouts, setLayouts]               = useState([])
  const [activeLayoutId, setActiveLayoutId] = useState(null)
  // drawings for the current layout (array of drawing objects)
  const [drawings, setDrawings]             = useState([])
  // Debounce timer ref for auto-saving drawings
  const saveDrawingsTimer = useRef(null)

  const handleSessionExpired = () => {
    localStorage.removeItem('cv_token')
    setToken(null)
    setPrefsLoaded(false)
    setCurrentUser(null)
  }

  // ── Startup: load prefs, watchlist, user info, layouts ────────────────────
  useEffect(() => {
    if (!token) return

    fetchPreferences()
      .then((prefs) => {
        if (prefs.ticker)   setActiveTicker(prefs.ticker)
        if (prefs.interval) setInterval(prefs.interval)
        if (prefs.date)     { setDate(prefs.date); setChartCenter(prefs.date) }
        setPrefsLoaded(true)
        return prefs.active_layout_id ?? null
      })
      .then((savedLayoutId) => {
        return fetchLayouts().then(({ layouts: ls }) => {
          if (ls.length === 0) {
            // Create the default layout on first run
            return createLayout(DEFAULT_LAYOUT_NAME).then((created) => {
              const first = { id: created.id, name: created.name, drawings: '[]' }
              setLayouts([first])
              setActiveLayoutId(first.id)
              setDrawings([])
            })
          }
          setLayouts(ls)
          const target = ls.find((l) => l.id === savedLayoutId) ?? ls[0]
          setActiveLayoutId(target.id)
          setDrawings(parseDrawings(target.drawings))
        })
      })
      .catch((e) => {
        if (e.status === 401) handleSessionExpired()
        else setPrefsLoaded(true)
      })

    fetchWatchlist()
      .then((data) => {
        setTickers(data.symbols)
        if (!activeTicker && data.symbols.length > 0) {
          setActiveTicker(data.symbols[0].ticker)
        }
      })
      .catch((e) => { if (e.status === 401) handleSessionExpired() })

    fetchMe()
      .then(setCurrentUser)
      .catch(() => {})
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── OHLC data loading ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!activeTicker) return
    setLoading(true)
    setChartError(null)
    try {
      const [start, end] = windowForInterval(interval, date)
      const result = await fetchOHLC(activeTicker, interval, start, end)
      setBars(result.bars)
      if (result.bars.length === 0) {
        setToast(`No data found for ${activeTicker}`)
      } else {
        const centerMs   = new Date(date).getTime()
        const firstBarMs = result.bars[0].ts * 1000
        if (firstBarMs > centerMs + 3 * 86400_000) {
          const firstDate = new Date(firstBarMs).toLocaleDateString()
          setToast(`${interval} data unavailable before ${firstDate}`)
        }
      }
    } catch (e) {
      if (e.status === 401) handleSessionExpired()
      else {
        setToast(e.message)
        setBars([])
        setChartError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }, [activeTicker, interval, date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prefsLoaded) loadData()
  }, [loadData, prefsLoaded])

  // ── Ticker / interval / date handlers ─────────────────────────────────────
  const handleSelect = (ticker) => {
    if (replayMode !== 'idle') handleExitReplay()
    setActiveTicker(ticker)
    setBars([])
    setChartCenter(date)
    if (prefsLoaded) savePreferences({ ticker, interval, date, active_layout_id: activeLayoutId }).catch(() => {})
  }

  const handleIntervalChange = (v) => {
    if (replayMode !== 'idle') handleExitReplay()
    setInterval(v)
    setBars([])
    setChartCenter(date)
    if (prefsLoaded) savePreferences({ ticker: activeTicker, interval: v, date, active_layout_id: activeLayoutId }).catch(() => {})
  }

  const handleDateChange = (v) => {
    setDate(v)
    setChartCenter(v)
    if (prefsLoaded) savePreferences({ ticker: activeTicker, interval, date: v, active_layout_id: activeLayoutId }).catch(() => {})
  }

  const handleScrolledTo = useCallback((newCenter) => {
    setDate(newCenter)
  }, [])

  // ── Replay handlers ────────────────────────────────────────────────────────
  const handleExitReplay = useCallback(() => {
    window.clearInterval(replayTimerRef.current)
    setReplayMode('idle')
    setReplayBars(null)
    setReplayIndex(null)
  }, [])

  const handleReplayClick = useCallback(async () => {
    if (replayMode !== 'idle') { handleExitReplay(); return }
    if (!activeTicker) return
    setLoading(true)
    setChartError(null)
    try {
      const [start, end] = windowForInterval(interval, today())
      const result = await fetchOHLC(activeTicker, interval, start, end)
      setReplayBars(result.bars)
      setReplayMode('cut')
    } catch (e) {
      if (e.status === 401) handleSessionExpired()
      else { setToast(e.message); setChartError(e.message) }
    } finally {
      setLoading(false)
    }
  }, [replayMode, activeTicker, interval, handleExitReplay]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCutConfirm = useCallback((index) => {
    const maxIdx = replayIndexRef.current !== null ? replayIndexRef.current - 1 : Infinity
    const clamped = Math.min(index, maxIdx)
    if (clamped < 0) return
    setReplayIndex(clamped)
    setReplayMode('paused')
  }, [])

  const handleStep = useCallback(() => {
    setReplayIndex((prev) => {
      if (prev === null || !replayBarsRef.current) return prev
      const next = Math.min(prev + 1, replayBarsRef.current.length - 1)
      replayIndexRef.current = next
      return next
    })
  }, [])

  const handlePlayPause = useCallback(() => {
    // Just toggle the mode — the useEffect below owns the interval lifecycle
    setReplayMode((mode) => (mode === 'playing' ? 'paused' : 'playing'))
  }, [])

  // Single source of truth for the play interval.
  // Must use window.setInterval — plain `setInterval` is shadowed by the
  // `interval` state setter (`const [interval, setInterval] = useState(...)`).
  useEffect(() => {
    if (replayMode !== 'playing') {
      window.clearInterval(replayTimerRef.current)
      return
    }
    replayTimerRef.current = window.setInterval(() => {
      setReplayIndex((prev) => {
        if (prev === null || !replayBarsRef.current) return prev
        if (prev >= replayBarsRef.current.length - 1) {
          setReplayMode('paused')
          return prev
        }
        return prev + 1
      })
    }, 1000 / replaySpeed)
    return () => window.clearInterval(replayTimerRef.current)
  }, [replayMode, replaySpeed])

  const handleSpeedChange = useCallback((speed) => {
    setReplaySpeed(speed)
  }, [])

  const handleRandomDate = useCallback(async () => {
    if (!replayBarsRef.current || replayBarsRef.current.length === 0) return
    try {
      const { earliest_ts, latest_ts } = await fetchOHLCRange(activeTicker, interval)
      const barDur = barDurationSeconds(interval)
      const latestAllowed = latest_ts - 30 * barDur
      if (earliest_ts >= latestAllowed) {
        setToast('Not enough cached data for a random date')
        return
      }
      const randomTs = earliest_ts + Math.random() * (latestAllowed - earliest_ts)
      const pool = replayBarsRef.current
      let best = 0, minDiff = Infinity
      for (let i = 0; i < pool.length; i++) {
        const d = Math.abs(pool[i].ts - randomTs)
        if (d < minDiff) { minDiff = d; best = i }
      }
      handleCutConfirm(best)
    } catch (e) {
      setToast(e.message)
    }
  }, [activeTicker, interval, handleCutConfirm])

  // ── Watchlist handlers ─────────────────────────────────────────────────────
  const handleAdd = ({ ticker, label }) => {
    if (tickers.find((t) => t.ticker === ticker)) {
      setToast(`${label} is already in your watchlist`)
      return
    }
    const updated = [...tickers, { ticker, label }]
    setTickers(updated)
    setActiveTicker(ticker)
    saveWatchlist(updated).catch(() => setToast('Failed to save watchlist'))
  }

  const handleRemove = (ticker) => {
    const updated = tickers.filter((t) => t.ticker !== ticker)
    setTickers(updated)
    if (activeTicker === ticker) setActiveTicker(updated[0]?.ticker ?? null)
    saveWatchlist(updated).catch(() => setToast('Failed to save watchlist'))
  }

  const handleReorder = (reordered) => {
    setTickers(reordered)
    saveWatchlist(reordered).catch(() => setToast('Failed to save watchlist'))
  }

  // ── Drawing handlers ───────────────────────────────────────────────────────
  const persistDrawings = useCallback((id, list) => {
    clearTimeout(saveDrawingsTimer.current)
    saveDrawingsTimer.current = setTimeout(() => {
      updateLayout(id, { drawings: list }).catch(() => {})
    }, 800)
  }, [])

  const handleDrawingAdd = useCallback((drawing) => {
    setDrawings((prev) => {
      const next = [...prev, drawing]
      persistDrawings(activeLayoutId, next)
      return next
    })
  }, [activeLayoutId, persistDrawings])

  const handleDrawingUpdate = useCallback((updated) => {
    setDrawings((prev) => {
      const next = prev.map((d) => d.id === updated.id ? updated : d)
      persistDrawings(activeLayoutId, next)
      return next
    })
  }, [activeLayoutId, persistDrawings])

  const handleDrawingDelete = useCallback((id) => {
    setDrawings((prev) => {
      const next = prev.filter((d) => d.id !== id)
      persistDrawings(activeLayoutId, next)
      return next
    })
  }, [activeLayoutId, persistDrawings])

  const handleClearAll = useCallback(() => {
    setDrawings([])
    persistDrawings(activeLayoutId, [])
  }, [activeLayoutId, persistDrawings])

  // ── Layout handlers ────────────────────────────────────────────────────────
  const handleLayoutSelect = (id) => {
    const layout = layouts.find((l) => l.id === id)
    if (!layout) return
    setActiveLayoutId(id)
    setDrawings(parseDrawings(layout.drawings))
    savePreferences({ ticker: activeTicker, interval, date, active_layout_id: id }).catch(() => {})
  }

  const handleLayoutCreate = (name) => {
    createLayout(name)
      .then((created) => {
        const newLayout = { id: created.id, name: created.name, drawings: '[]' }
        setLayouts((prev) => [...prev, newLayout])
        setActiveLayoutId(created.id)
        setDrawings([])
        savePreferences({ ticker: activeTicker, interval, date, active_layout_id: created.id }).catch(() => {})
      })
      .catch(() => setToast('Failed to create layout'))
  }

  const handleLayoutRename = (id, name) => {
    updateLayout(id, { name })
      .then(() => setLayouts((prev) => prev.map((l) => l.id === id ? { ...l, name } : l)))
      .catch(() => setToast('Failed to rename layout'))
  }

  const handleLayoutDelete = (id) => {
    if (layouts.length <= 1) return
    deleteLayout(id)
      .then(() => {
        const remaining = layouts.filter((l) => l.id !== id)
        setLayouts(remaining)
        if (activeLayoutId === id) {
          const next = remaining[0]
          setActiveLayoutId(next.id)
          setDrawings(parseDrawings(next.drawings))
          savePreferences({ ticker: activeTicker, interval, date, active_layout_id: next.id }).catch(() => {})
        }
      })
      .catch(() => setToast('Failed to delete layout'))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!token)       return <AuthPage onLogin={setToken} />
  if (!prefsLoaded) return null

  const activeLabel = tickers.find((t) => t.ticker === activeTicker)?.label ?? activeTicker

  return (
    <div style={appStyle}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{ position: 'relative', display: 'flex' }}>
          <TickerList
            tickers={tickers}
            activeTicker={activeTicker}
            onSelect={handleSelect}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onReorder={handleReorder}
          />
          <button onClick={() => setSidebarOpen(false)} style={collapseBtnStyle} title="Hide sidebar">
            ‹
          </button>
        </div>
      )}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} style={expandBtnStyle} title="Show sidebar">
          ›
        </button>
      )}

      {/* Drawing toolbar */}
      <DrawingToolbar
        activeTool={drawingTool}
        onToolChange={setDrawingTool}
        onClearAll={handleClearAll}
      />

      {/* Main panel */}
      <div style={mainStyle}>
        {/* Top bar */}
        <div style={topBarStyle}>
          <span style={symbolNameStyle}>{activeLabel}</span>
          <Toolbar
            interval={interval}
            onIntervalChange={handleIntervalChange}
            date={date}
            onDateChange={handleDateChange}
            onReplayClick={handleReplayClick}
            replayMode={replayMode}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            <LayoutManager
              layouts={layouts}
              activeLayoutId={activeLayoutId}
              onSelect={handleLayoutSelect}
              onCreate={handleLayoutCreate}
              onRename={handleLayoutRename}
              onDelete={handleLayoutDelete}
            />
            {currentUser?.is_admin && <InviteButton />}
            <button style={logoutBtnStyle} onClick={handleSessionExpired} title={`Sign out (${currentUser?.username})`}>
              Sign out
            </button>
          </div>
        </div>

        {/* Chart */}
        <div style={{ ...chartWrapStyle, position: 'relative' }}>
          <Chart
            bars={bars}
            interval={interval}
            targetDate={chartCenter}
            onScrolledTo={handleScrolledTo}
            loading={loading}
            errorMessage={chartError}
            drawingTool={replayMode !== 'idle' ? 'cursor' : drawingTool}
            drawings={drawings}
            fibLevels={fibLevels}
            onDrawingAdd={handleDrawingAdd}
            onDrawingUpdate={handleDrawingUpdate}
            onDrawingDelete={handleDrawingDelete}
            onToolChange={setDrawingTool}
            replayBars={replayBars}
            replayIndex={replayIndex}
            replayMode={replayMode}
            onCutConfirm={handleCutConfirm}
          />
          {replayMode !== 'idle' && (
            <ReplayControls
              replayMode={replayMode}
              replaySpeed={replaySpeed}
              currentBarDate={
                replayBars && replayIndex !== null
                  ? new Date(replayBars[replayIndex].ts * 1000).toISOString().slice(0, 16).replace('T', ' ')
                  : ''
              }
              onExit={handleExitReplay}
              onCut={() => setReplayMode('cut')}
              onStep={handleStep}
              onPlayPause={handlePlayPause}
              onSpeedChange={handleSpeedChange}
              onRandomDate={handleRandomDate}
            />
          )}
        </div>
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDrawings(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const appStyle = {
  display:    'flex',
  height:     '100vh',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color:      '#c9d1d9',
  overflow:   'hidden',
}

const mainStyle = {
  flex:      1,
  display:   'flex',
  flexDirection: 'column',
  overflow:  'hidden',
}

const topBarStyle = {
  display:     'flex',
  alignItems:  'center',
  gap:         12,
  flexWrap:    'wrap',
}

const symbolNameStyle = {
  padding:      '8px 16px',
  fontSize:     15,
  fontWeight:   700,
  color:        '#e6edf3',
  background:   '#161b22',
  borderBottom: '1px solid #30363d',
  whiteSpace:   'nowrap',
}

const chartWrapStyle = {
  flex:     1,
  overflow: 'hidden',
}

const collapseBtnStyle = {
  position:       'absolute',
  right:          -12,
  top:            '50%',
  transform:      'translateY(-50%)',
  zIndex:         10,
  width:          20,
  height:         48,
  background:     '#21262d',
  border:         '1px solid #30363d',
  borderRadius:   '0 4px 4px 0',
  color:          '#6e7681',
  fontSize:       16,
  cursor:         'pointer',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  padding:        0,
}

const logoutBtnStyle = {
  padding:    '4px 10px',
  background: 'none',
  border:     '1px solid #30363d',
  borderRadius: 6,
  color:      '#8b949e',
  fontSize:   13,
  cursor:     'pointer',
  whiteSpace: 'nowrap',
}

const expandBtnStyle = {
  width:        20,
  minWidth:     20,
  background:   '#21262d',
  border:       '1px solid #30363d',
  borderLeft:   'none',
  borderRadius: '0 4px 4px 0',
  color:        '#6e7681',
  fontSize:     16,
  cursor:       'pointer',
  padding:      0,
  alignSelf:    'stretch',
}
