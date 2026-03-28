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

export default function Chart({ bars, interval, targetDate, loading }) {
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
    if (!seriesRef.current || !bars) return

    const formatted = bars.map((b) => ({
      time: b.ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    seriesRef.current.setData(formatted)

    // Scroll to targetDate if provided
    if (targetDate && formatted.length > 0 && chartRef.current) {
      const targetTs = Math.floor(new Date(targetDate).getTime() / 1000)
      chartRef.current.timeScale().scrollToPosition(0, false)
      // Find the nearest bar and set visible range around it
      const nearest = formatted.reduce((prev, cur) =>
        Math.abs(cur.time - targetTs) < Math.abs(prev.time - targetTs) ? cur : prev
      )
      chartRef.current.timeScale().scrollToRealTime()

      // Show ~100 bars centred on target
      const idx = formatted.indexOf(nearest)
      const half = 50
      const visFrom = formatted[Math.max(0, idx - half)]?.time
      const visTo = formatted[Math.min(formatted.length - 1, idx + half)]?.time
      if (visFrom && visTo) {
        chartRef.current.timeScale().setVisibleRange({ from: visFrom, to: visTo })
      }
    } else if (formatted.length > 0 && chartRef.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [bars, targetDate])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={loadingOverlayStyle}>Loading…</div>
      )}
      {!loading && bars && bars.length === 0 && (
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
