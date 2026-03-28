import { useState, useEffect, useCallback } from 'react'
import Chart from './components/Chart.jsx'
import Toolbar from './components/Toolbar.jsx'
import TickerList from './components/TickerList.jsx'
import { fetchOHLC, fetchSymbols, windowForInterval } from './api.js'

const today = () => new Date().toISOString().slice(0, 10)

const DEFAULT_TICKERS = [
  { ticker: 'XAUUSD=X', label: 'XAU/USD' },
  { ticker: 'EURUSD=X', label: 'EUR/USD' },
  { ticker: 'GBPUSD=X', label: 'GBP/USD' },
  { ticker: 'USDJPY=X', label: 'USD/JPY' },
  { ticker: 'USDCHF=X', label: 'USD/CHF' },
  { ticker: 'AUDUSD=X', label: 'AUD/USD' },
  { ticker: 'USDCAD=X', label: 'USD/CAD' },
]

export default function App() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS)
  const [activeTicker, setActiveTicker] = useState(DEFAULT_TICKERS[0].ticker)
  const [interval, setInterval] = useState('1h')
  const [date, setDate] = useState(today())
  const [bars, setBars] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadData = useCallback(async () => {
    if (!activeTicker) return
    setLoading(true)
    setError(null)
    try {
      const [start, end] = windowForInterval(interval, date)
      const result = await fetchOHLC(activeTicker, interval, start, end)
      setBars(result.bars)
    } catch (e) {
      setError(e.message)
      setBars([])
    } finally {
      setLoading(false)
    }
  }, [activeTicker, interval, date])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Load default symbols from server on first mount
  useEffect(() => {
    fetchSymbols()
      .then((data) => setTickers(data.symbols))
      .catch(() => {/* keep defaults */})
  }, [])

  const handleSelect = (ticker) => setActiveTicker(ticker)

  const handleAdd = (ticker) => {
    if (tickers.find((t) => t.ticker === ticker)) return
    setTickers((prev) => [...prev, { ticker, label: ticker }])
    setActiveTicker(ticker)
  }

  const handleRemove = (ticker) => {
    setTickers((prev) => prev.filter((t) => t.ticker !== ticker))
    if (activeTicker === ticker) {
      const remaining = tickers.filter((t) => t.ticker !== ticker)
      setActiveTicker(remaining[0]?.ticker ?? null)
    }
  }

  const activeLabel = tickers.find((t) => t.ticker === activeTicker)?.label ?? activeTicker

  return (
    <div style={appStyle}>
      {/* Sidebar */}
      <TickerList
        tickers={tickers}
        activeTicker={activeTicker}
        onSelect={handleSelect}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />

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

        {/* Error banner */}
        {error && (
          <div style={errorStyle}>{error}</div>
        )}

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

const errorStyle = {
  padding: '8px 16px',
  background: '#3d1a1a',
  color: '#f85149',
  fontSize: 13,
  borderBottom: '1px solid #f85149',
}
