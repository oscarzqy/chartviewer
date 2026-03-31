import { useEffect, useRef, useCallback } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'

const CHART_THEME = {
  layout: {
    background: { color: '#0d1117' },
    textColor: '#c9d1d9',
    fontSize: 12,
  },
  grid: {
    vertLines: { color: '#21262d' },
    horzLines: { color: '#21262d' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: '#6e7681', labelBackgroundColor: '#21262d' },
    horzLine: { color: '#6e7681', labelBackgroundColor: '#21262d' },
  },
  timeScale: {
    borderColor: '#30363d',
    timeVisible: true,
    secondsVisible: false,
  },
  rightPriceScale: {
    borderColor: '#30363d',
  },
}

const CANDLE_COLORS = {
  upColor: '#26a641',
  downColor: '#f85149',
  borderUpColor: '#26a641',
  borderDownColor: '#f85149',
  wickUpColor: '#26a641',
  wickDownColor: '#f85149',
}

export default function Chart({ bars, interval, targetDate, loading, errorMessage }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      ...CHART_THEME,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })

    const series = chart.addCandlestickSeries(CANDLE_COLORS)
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        chart.resize(width, height)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Update data when bars change
  useEffect(() => {
    if (!seriesRef.current || !bars || !chartRef.current) return

    const formatted = bars.map((b) => ({
      time: b.ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    seriesRef.current.setData(formatted)

    if (formatted.length === 0) return

    // Set price precision based on the median close price
    const mid = formatted[Math.floor(formatted.length / 2)].close
    const priceFormat = mid < 2     ? { precision: 5, minMove: 0.00001 }
                      : mid < 20    ? { precision: 4, minMove: 0.0001  }
                      : mid < 200   ? { precision: 3, minMove: 0.001   }
                      : mid < 5000  ? { precision: 2, minMove: 0.01    }
                      :               { precision: 1, minMove: 0.1     }
    seriesRef.current.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })

    // Number of bars to show in the visible window per interval
    const VISIBLE_BARS = {
      '5m': 96, '15m': 96, '1h': 120, '4h': 120,
      '1d': 120, '1wk': 104, '1mo': 60, '1y': 20,
    }
    const half = Math.floor((VISIBLE_BARS[interval] ?? 120) / 2)

    // Find the bar closest to targetDate (or use the last bar)
    const targetTs = targetDate
      ? Math.floor(new Date(targetDate).getTime() / 1000)
      : formatted[formatted.length - 1].time

    let idx = formatted.length - 1
    let minDiff = Infinity
    for (let i = 0; i < formatted.length; i++) {
      const diff = Math.abs(formatted[i].time - targetTs)
      if (diff < minDiff) { minDiff = diff; idx = i }
    }

    const from = formatted[Math.max(0, idx - half)].time
    const to   = formatted[Math.min(formatted.length - 1, idx + half)].time
    chartRef.current.timeScale().setVisibleRange({ from, to })
  }, [bars, targetDate, interval])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={loadingOverlayStyle}>Loading…</div>
      )}
      {!loading && errorMessage && (
        <div style={errorOverlayStyle}>{errorMessage}</div>
      )}
      {!loading && !errorMessage && bars && bars.length === 0 && (
        <div style={loadingOverlayStyle}>No data available for this range</div>
      )}
    </div>
  )
}

const loadingOverlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6e7681',
  fontSize: 14,
  pointerEvents: 'none',
}

const errorOverlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f85149',
  fontSize: 14,
  padding: '0 40px',
  textAlign: 'center',
  pointerEvents: 'none',
}
