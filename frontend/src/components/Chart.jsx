import { useEffect, useRef, useCallback, useMemo } from 'react'
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
  // Replay props
  replayBars,
  replayIndex,
  replayMode,
  onCutConfirm,
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

  // Replay refs — used imperatively inside event listeners
  const replayModeRef  = useRef(replayMode)
  const replayBarsRef  = useRef(replayBars)
  const replayIndexRef = useRef(replayIndex)
  const cutLineRef     = useRef(null)   // the cut line div element
  const snappedIdxRef  = useRef(null)   // bar index currently snapped to in cut mode

  useEffect(() => { onScrolledToRef.current = onScrolledTo }, [onScrolledTo])
  useEffect(() => { targetDateRef.current = targetDate }, [targetDate])
  useEffect(() => { intervalRef.current = interval }, [interval])
  const prevReplayModeRef = useRef('idle')
  useEffect(() => {
    // When transitioning out of replay, flag the next bars render to re-center.
    // This effect is declared before the displayBars effect so it runs first.
    if (prevReplayModeRef.current !== 'idle' && replayMode === 'idle') {
      centerPendingRef.current = true
    }
    prevReplayModeRef.current = replayMode
    replayModeRef.current = replayMode
  }, [replayMode])
  useEffect(() => { replayBarsRef.current = replayBars }, [replayBars])
  useEffect(() => { replayIndexRef.current = replayIndex }, [replayIndex])

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
      if (suppressScrollRef.current || replayModeRef.current !== 'idle' || !range || !formattedRef.current.length) return
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

  // Derive the bars to actually render: replay slice or normal bars.
  // Memoized so the bars effect only fires when content changes, not on every render.
  const displayBars = useMemo(
    () => (replayBars !== null && replayIndex !== null)
      ? replayBars.slice(0, replayIndex + 1)
      : bars,
    [replayBars, replayIndex, bars],
  )

  // Effect: update series data when displayBars change.
  useEffect(() => {
    if (!seriesRef.current || !displayBars || !chartRef.current) return

    const formatted = displayBars.map((b) => ({
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
    } else if (replayModeRef.current !== 'idle') {
      // During replay: keep the last visible bar at ~80% of the window so new bars
      // appear on the right edge as they reveal, without resetting the viewport.
      const visibleRange = chartRef.current.timeScale().getVisibleRange()
      if (visibleRange) {
        const lastBar = formatted[formatted.length - 1]
        if (lastBar.time > visibleRange.to) {
          // New bar is off-screen — shift the window forward by one bar width
          const windowWidth = visibleRange.to - visibleRange.from
          suppressScrollRef.current = true
          chartRef.current.timeScale().setVisibleRange({
            from: lastBar.time - windowWidth,
            to:   lastBar.time,
          })
          suppressScrollRef.current = false
        }
        // If bar is already in view, do nothing — let user scroll freely
      }
    } else if (savedRange) {
      suppressScrollRef.current = true
      chartRef.current.timeScale().setVisibleRange(savedRange)
      suppressScrollRef.current = false
    }
  }, [displayBars, centerViewport]) // eslint-disable-line react-hooks/exhaustive-deps

  // Effect: when targetDate or interval changes explicitly (user pick / ticker switch),
  // mark that the next bars load should re-center.
  useEffect(() => {
    centerPendingRef.current = true
    if (formattedRef.current.length > 0) {
      centerViewport(formattedRef.current)
    }
  }, [targetDate, interval, centerViewport])


  // Effect: cut line — mousemove snaps a vertical line to the nearest bar,
  // click confirms the cut. Active only when replayMode === 'cut'.
  useEffect(() => {
    if (replayMode !== 'cut') return
    const container = containerRef.current
    if (!container) return

    const onMove = (e) => {
      const chart = chartRef.current
      if (!chart || !cutLineRef.current) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left

      // Find the pool of bars to snap to: limited to already-visible bars during re-cut
      const pool = replayIndexRef.current !== null
        ? replayBarsRef.current.slice(0, replayIndexRef.current)  // backwards-only re-cut
        : replayBarsRef.current  // initial cut: full range

      if (!pool || pool.length === 0) return

      // Get the timestamp at this x coordinate
      const ts = chart.timeScale().coordinateToTime(x)
      if (ts == null) return

      // Snap to nearest bar in pool
      let best = 0, minDiff = Infinity
      for (let i = 0; i < pool.length; i++) {
        const d = Math.abs(pool[i].ts - ts)
        if (d < minDiff) { minDiff = d; best = i }
      }
      snappedIdxRef.current = best

      // Convert snapped bar time back to pixel x
      const snappedX = chart.timeScale().timeToCoordinate(pool[best].ts)
      if (snappedX == null) return
      cutLineRef.current.style.left = `${snappedX}px`
      cutLineRef.current.style.display = 'block'
    }

    const onClick = () => {
      if (snappedIdxRef.current !== null) {
        onCutConfirm(snappedIdxRef.current)
      }
    }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('click', onClick)
      snappedIdxRef.current = null
      if (cutLineRef.current) cutLineRef.current.style.display = 'none'
    }
  }, [replayMode, onCutConfirm])

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', width: '100%', height: '100%', cursor: replayMode === 'cut' ? 'crosshair' : undefined }}
      onMouseMove={(e) => { if (replayMode !== 'cut') drawingCanvasRef.current?.handleMouseMove(e) }}
      onMouseLeave={(e) => { if (replayMode !== 'cut') drawingCanvasRef.current?.handleMouseLeave(e) }}
      onMouseDown={(e) => { if (replayMode !== 'cut') drawingCanvasRef.current?.handleMouseDown(e) }}
      onClick={(e) => { if (replayMode !== 'cut') drawingCanvasRef.current?.handleClick(e) }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Cut line — shown in cut mode, positioned imperatively via cutLineRef */}
      <div
        ref={cutLineRef}
        style={{
          display:          'none',
          position:         'absolute',
          top:              0,
          bottom:           0,
          width:            1,
          background:       '#f0b429',
          opacity:          0.85,
          pointerEvents:    'none',
          zIndex:           25,
        }}
      />

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
      {!loading && !errorMessage && replayMode === 'idle' && bars && bars.length === 0 && (
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
