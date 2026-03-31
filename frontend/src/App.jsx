import { useState, useEffect, useCallback } from 'react'
import Chart from './components/Chart.jsx'
import Toolbar from './components/Toolbar.jsx'
import TickerList from './components/TickerList.jsx'
import Toast from './components/Toast.jsx'
import AuthPage from './components/AuthPage.jsx'
import InviteButton from './components/InviteButton.jsx'
import {
  fetchOHLC,
  fetchWatchlist,
  saveWatchlist,
  fetchPreferences,
  savePreferences,
  fetchMe,
  windowForInterval,
} from './api.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('cv_token'))
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)

  const [tickers, setTickers] = useState([])
  const [activeTicker, setActiveTicker] = useState(null)
  const [interval, setInterval] = useState('1h')
  const [date, setDate] = useState(today())
  const [bars, setBars] = useState(null)
  const [chartCenter, setChartCenter] = useState(today())  // only updated on explicit user picks
  const [chartError, setChartError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleSessionExpired = () => {
    localStorage.removeItem('cv_token')
    setToken(null)
    setPrefsLoaded(false)
    setCurrentUser(null)
  }

  // Load preferences, watchlist, and sources once token is available
  useEffect(() => {
    if (!token) return
    fetchPreferences()
      .then((prefs) => {
        if (prefs.ticker) setActiveTicker(prefs.ticker)
        if (prefs.interval) setInterval(prefs.interval)
        if (prefs.date) { setDate(prefs.date); setChartCenter(prefs.date) }
        setPrefsLoaded(true)
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
      .catch((e) => {
        if (e.status === 401) handleSessionExpired()
      })
    fetchMe()
      .then(setCurrentUser)
      .catch(() => {})
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

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
        const centerMs = new Date(date).getTime()
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

  const handleSelect = (ticker) => {
    setActiveTicker(ticker)
    setBars([])  // clear so new ticker's data centers correctly
    setChartCenter(date)
    if (prefsLoaded) savePreferences({ ticker, interval, date }).catch(() => {})
  }

  const handleIntervalChange = (v) => {
    setInterval(v)
    setBars([])  // clear so new interval's data centers correctly
    setChartCenter(date)
    if (prefsLoaded) savePreferences({ ticker: activeTicker, interval: v, date }).catch(() => {})
  }

  const handleDateChange = (v) => {
    setDate(v)
    setChartCenter(v)  // explicit pick — chart should re-center
    if (prefsLoaded) savePreferences({ ticker: activeTicker, interval, date: v }).catch(() => {})
  }

  // Called by Chart when the user drags/scrolls to a new date.
  // Updates the date picker and triggers a fetch for the new center, but does NOT
  // re-center the chart (the viewport stays where the user dragged).
  const handleScrolledTo = useCallback((newCenter) => {
    setDate(newCenter)
    // Intentionally do not update chartCenter — no re-centering on drag
  }, [])

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

  if (!token) return <AuthPage onLogin={setToken} />
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
          <button onClick={() => setSidebarOpen(false)} style={collapsebtnStyle} title="Hide sidebar">
            ‹
          </button>
        </div>
      )}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} style={expandBtnStyle} title="Show sidebar">
          ›
        </button>
      )}

      {/* Main panel */}
      <div style={mainStyle}>
        {/* Top bar: symbol name + toolbar */}
        <div style={topBarStyle}>
          <span style={symbolNameStyle}>{activeLabel}</span>
          <Toolbar
            interval={interval}
            onIntervalChange={handleIntervalChange}
            date={date}
            onDateChange={handleDateChange}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            {currentUser?.is_admin && <InviteButton />}
            <button style={logoutBtnStyle} onClick={handleSessionExpired} title={`Sign out (${currentUser?.username})`}>
              Sign out
            </button>
          </div>
        </div>

        {/* Chart */}
        <div style={chartWrapStyle}>
          <Chart
            bars={bars}
            interval={interval}
            targetDate={chartCenter}
            onScrolledTo={handleScrolledTo}
            loading={loading}
            errorMessage={chartError}
          />
        </div>
      </div>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

const appStyle = {
  display: 'flex',
  height: '100vh',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: '#c9d1d9',
  overflow: 'hidden',
}

const mainStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const topBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
}

const symbolNameStyle = {
  padding: '8px 16px',
  fontSize: 15,
  fontWeight: 700,
  color: '#e6edf3',
  background: '#161b22',
  borderBottom: '1px solid #30363d',
  whiteSpace: 'nowrap',
}

const chartWrapStyle = {
  flex: 1,
  overflow: 'hidden',
}

const collapsebtnStyle = {
  position: 'absolute',
  right: -12,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 10,
  width: 20,
  height: 48,
  background: '#21262d',
  border: '1px solid #30363d',
  borderRadius: '0 4px 4px 0',
  color: '#6e7681',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

const logoutBtnStyle = {
  padding: '4px 10px',
  background: 'none',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#8b949e',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const expandBtnStyle = {
  width: 20,
  minWidth: 20,
  background: '#21262d',
  border: '1px solid #30363d',
  borderLeft: 'none',
  borderRadius: '0 4px 4px 0',
  color: '#6e7681',
  fontSize: 16,
  cursor: 'pointer',
  padding: 0,
  alignSelf: 'stretch',
}
