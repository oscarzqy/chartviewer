import { useEffect, useRef, useCallback } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import DrawingCanvas from './DrawingCanvas.jsx'

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

export default function Chart({
  bars,
  interval,
  targetDate,
  onScrolledTo,
  loading,
  errorMessage,
  // Drawing props
  drawingTool,
  drawings,
  fibLevels,
  onDrawingAdd,
  onDrawingUpdate,
  onDrawingDelete,
  onToolChange,
}) {
  const containerRef     = useRef(null)
  const chartRef         = useRef(null)
  const seriesRef        = useRef(null)
  const wrapperRef       = useRef(null)
  const drawingCanvasRef = useRef(null)

  // Refs to avoid stale closures in stable callbacks
  const formattedRef      = useRef([])
  const suppressScrollRef = useRef(false)
  const onScrolledToRef   = useRef(onScrolledTo)
  const targetDateRef     = useRef(targetDate)
  const intervalRef       = useRef(interval)
  // true = next bars load should center the chart; false = restore current viewport
  const centerPendingRef  = useRef(true)

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

  // 'A' key — fit all data to screen (like TV)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'a' || e.key === 'A') {
        if (e.target.tagName === 'INPUT') return
        chartRef.current?.applyOptions({ rightPriceScale: { autoScale: true } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll wheel on Y-axis — zoom the price scale
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e) => {
      const chart = chartRef.current
      if (!chart) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const priceScaleWidth = chart.priceScale('right').width()
      if (x < rect.width - priceScaleWidth) return  // not over price scale
      e.preventDefault()
      e.stopPropagation()
      const margins = chart.priceScale('right').options().scaleMargins ?? { top: 0.1, bottom: 0.1 }
      const delta = e.deltaY > 0 ? 0.03 : -0.03  // down = zoom out, up = zoom in
      chart.applyOptions({
        rightPriceScale: {
          autoScale: false,
          scaleMargins: {
            top:    Math.max(0.01, Math.min(0.48, margins.top    + delta)),
            bottom: Math.max(0.01, Math.min(0.48, margins.bottom + delta)),
          },
        },
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  // Disable chart mouse scroll when a drawing tool is active (not cursor)
  useEffect(() => {
    if (!chartRef.current) return
    const drawing = drawingTool && drawingTool !== 'cursor'
    chartRef.current.applyOptions({
      handleScroll:  { mouseWheel: !drawing, pressedMouseMove: !drawing, horzTouchDrag: !drawing, vertTouchDrag: !drawing },
      handleScale:   { mouseWheel: !drawing, pinch: !drawing, axisPressedMouseMove: !drawing },
    })
  }, [drawingTool])

  // Effect: update series data when bars change.
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
    const savedRange = wasEmpty ? null : chartRef.current.timeScale().getVisibleRange()

    formattedRef.current = formatted
    suppressScrollRef.current = true
    seriesRef.current.setData(formatted)
    suppressScrollRef.current = false

    if (formatted.length === 0) return

    const mid = formatted[Math.floor(formatted.length / 2)].close
    const priceFormat = mid < 2     ? { precision: 5, minMove: 0.00001 }
                      : mid < 20    ? { precision: 4, minMove: 0.0001  }
                      : mid < 200   ? { precision: 3, minMove: 0.001   }
                      : mid < 5000  ? { precision: 2, minMove: 0.01    }
                      :               { precision: 1, minMove: 0.1     }
    seriesRef.current.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })

    if (wasEmpty || centerPendingRef.current) {
      centerPendingRef.current = false
      centerViewport(formatted)
    } else if (savedRange) {
      suppressScrollRef.current = true
      chartRef.current.timeScale().setVisibleRange(savedRange)
      suppressScrollRef.current = false
    }
  }, [bars, centerViewport])

  // Effect: when targetDate or interval changes explicitly (user pick / ticker switch),
  // mark that the next bars load should re-center.
  useEffect(() => {
    centerPendingRef.current = true
    if (formattedRef.current.length > 0) {
      centerViewport(formattedRef.current)
    }
  }, [targetDate, interval, centerViewport])

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onMouseMove={(e) => drawingCanvasRef.current?.handleMouseMove(e)}
      onMouseLeave={(e) => drawingCanvasRef.current?.handleMouseLeave(e)}
      onMouseDown={(e) => drawingCanvasRef.current?.handleMouseDown(e)}
      onClick={(e) => drawingCanvasRef.current?.handleClick(e)}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Drawing canvas — pointer-events:none so chart canvas gets events natively */}
      <DrawingCanvas
        ref={drawingCanvasRef}
        chartRef={chartRef}
        seriesRef={seriesRef}
        wrapperRef={wrapperRef}
        tool={drawingTool ?? 'cursor'}
        drawings={drawings ?? []}
        fibLevels={fibLevels}
        onDrawingAdd={onDrawingAdd ?? (() => {})}
        onDrawingUpdate={onDrawingUpdate}
        onDrawingDelete={onDrawingDelete}
        onToolChange={onToolChange}
      />

      {/* Fit-to-screen button — resets zoom/scale like TV's "Auto" */}
      <button
        title="Fit to screen (A)"
        onClick={() => {
          chartRef.current?.applyOptions({ rightPriceScale: { autoScale: true } })
        }}
        style={fitBtnStyle}
      >
        ⊡
      </button>

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

const fitBtnStyle = {
  position:        'absolute',
  bottom:          32,
  right:           60,
  zIndex:          20,
  background:      '#21262d',
  color:           '#c9d1d9',
  border:          '1px solid #30363d',
  borderRadius:    4,
  width:           24,
  height:          24,
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  cursor:          'pointer',
  fontSize:        14,
  lineHeight:      1,
  padding:         0,
  opacity:         0.75,
}
