import { useState, useEffect, useCallback } from 'react'
import Chart from './components/Chart.jsx'
import Toolbar from './components/Toolbar.jsx'
import TickerList from './components/TickerList.jsx'
import Toast from './components/Toast.jsx'
import { fetchOHLC, fetchWatchlist, saveWatchlist, windowForInterval } from './api.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function App() {
  const [tickers, setTickers] = useState([])
  const [activeTicker, setActiveTicker] = useState(null)
  const [interval, setInterval] = useState('1h')
  const [date, setDate] = useState(today())
  const [bars, setBars] = useState(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const loadData = useCallback(async () => {
    if (!activeTicker) return
    setLoading(true)
    try {
      const [start, end] = windowForInterval(interval, date)
      const result = await fetchOHLC(activeTicker, interval, start, end)
      setBars(result.bars)
    } catch (e) {
      setToast(e.message)
      setBars([])
    } finally {
      setLoading(false)
    }
  }, [activeTicker, interval, date])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Load watchlist from backend on first mount
  useEffect(() => {
    fetchWatchlist().then((data) => {
      setTickers(data.symbols)
      if (data.symbols.length > 0) setActiveTicker(data.symbols[0].ticker)
    }).catch(() => {})
  }, [])

  const handleSelect = (ticker) => setActiveTicker(ticker)

  const handleAdd = (ticker) => {
    if (tickers.find((t) => t.ticker === ticker)) {
      setToast(`${ticker} is already in your watchlist`)
      return
    }
    const updated = [...tickers, { ticker, label: ticker }]
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
            onIntervalChange={setInterval}
            date={date}
            onDateChange={setDate}
          />
        </div>

        {/* Chart */}
        <div style={chartWrapStyle}>
          <Chart
            bars={bars}
            interval={interval}
            targetDate={date}
            loading={loading}
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

