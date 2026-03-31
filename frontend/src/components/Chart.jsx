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

// Number of bars to show in the visible window per interval
const VISIBLE_BARS = {
  '5m': 96, '15m': 96, '1h': 120, '4h': 120,
  '1d': 120, '1wk': 104, '1mo': 60, '1y': 20,
}

export default function Chart({ bars, interval, targetDate, onScrolledTo, loading, errorMessage }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  // Refs to avoid stale closures in stable callbacks
  const formattedRef = useRef([])
  const suppressScrollRef = useRef(false)
  const onScrolledToRef = useRef(onScrolledTo)
  const targetDateRef = useRef(targetDate)
  const intervalRef = useRef(interval)
  // true = next bars load should center the chart; false = restore current viewport
  const centerPendingRef = useRef(true)

  useEffect(() => { onScrolledToRef.current = onScrolledTo }, [onScrolledTo])
  useEffect(() => { targetDateRef.current = targetDate }, [targetDate])
  useEffect(() => { intervalRef.current = interval }, [interval])

  // Stable helper: center chart on targetDate using current formattedRef data
  const centerViewport = useCallback((formatted) => {
    if (!chartRef.current || !formatted.length) return
    const half = Math.floor((VISIBLE_BARS[intervalRef.current] ?? 120) / 2)
    const targetTs = targetDateRef.current
      ? Math.floor(new Date(targetDateRef.current).getTime() / 1000)
      : formatted[formatted.length - 1].time

    let idx = formatted.length - 1
    let minDiff = Infinity
    for (let i = 0; i < formatted.length; i++) {
      const diff = Math.abs(formatted[i].time - targetTs)
      if (diff < minDiff) { minDiff = diff; idx = i }
    }

    const from = formatted[Math.max(0, idx - half)].time
    const to   = formatted[Math.min(formatted.length - 1, idx + half)].time
    suppressScrollRef.current = true
    chartRef.current.timeScale().setVisibleRange({ from, to })
    suppressScrollRef.current = false
  }, [])

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

    // Subscribe to scroll/zoom — debounced 300 ms to avoid spamming fetches
    let scrollTimer = null
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (suppressScrollRef.current || !range || !formattedRef.current.length) return
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        const centerTs = Math.round((range.from + range.to) / 2)
        const dateStr = new Date(centerTs * 1000).toISOString().slice(0, 10)
        onScrolledToRef.current?.(dateStr)
      }, 300)
    })

    return () => {
      clearTimeout(scrollTimer)
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Effect: update series data when bars change.
  // If the chart was empty (initial / ticker / interval change) OR an explicit re-center
  // was requested, center the viewport. Otherwise preserve the user's scroll position
  // so drag-triggered loads don't snap the chart back.
  useEffect(() => {
    if (!seriesRef.current || !bars || !chartRef.current) return

    const formatted = bars.map((b) => ({
      time: b.ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))

    const wasEmpty = formattedRef.current.length === 0
    // Save viewport BEFORE setData (which may reset it)
    const savedRange = wasEmpty ? null : chartRef.current.timeScale().getVisibleRange()

    formattedRef.current = formatted
    suppressScrollRef.current = true
    seriesRef.current.setData(formatted)
    suppressScrollRef.current = false

    if (formatted.length === 0) return

    // Price precision based on the median close price
    const mid = formatted[Math.floor(formatted.length / 2)].close
    const priceFormat = mid < 2     ? { precision: 5, minMove: 0.00001 }
                      : mid < 20    ? { precision: 4, minMove: 0.0001  }
                      : mid < 200   ? { precision: 3, minMove: 0.001   }
                      : mid < 5000  ? { precision: 2, minMove: 0.01    }
                      :               { precision: 1, minMove: 0.1     }
    seriesRef.current.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })

    if (wasEmpty || centerPendingRef.current) {
      // Fresh data load or explicit pick — center on targetDate
      centerPendingRef.current = false
      centerViewport(formatted)
    } else if (savedRange) {
      // Drag-triggered load — restore the user's scroll position
      suppressScrollRef.current = true
      chartRef.current.timeScale().setVisibleRange(savedRange)
      suppressScrollRef.current = false
    }
  }, [bars, centerViewport])

  // Effect: when targetDate or interval changes explicitly (user pick / ticker switch),
  // mark that the next bars load should re-center, and center immediately with
  // whatever data is already loaded for instant feedback.
  useEffect(() => {
    centerPendingRef.current = true
    if (formattedRef.current.length > 0) {
      centerViewport(formattedRef.current)
    }
  }, [targetDate, interval, centerViewport])

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
