/**
 * DrawingCanvas — canvas overlay for placing and editing chart drawings.
 *
 * Design notes:
 *  - Zero useState. All mutable tracking (mouse pos, hover, drag, pending point)
 *    lives in refs so mouse movement never triggers React re-renders → no flash.
 *  - scheduleRender is created once (stable identity) so the chart viewport
 *    subscription never re-registers.
 *  - In cursor mode, pointer-events stay 'auto'. A miss on mousedown temporarily
 *    sets pointer-events:'none' so the chart's own canvas receives the event for
 *    native panning, then restores on document mouseup.
 */
import { useEffect, useRef, useCallback } from 'react'

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

const TOOL_COLOR = {
  trendline:       '#2196F3',
  horizontal_line: '#2196F3',
  ray:             '#FF9800',
  horizontal_ray:  '#FF9800',
  fib_retracement: '#FFD700',
  rectangle:       '#9C27B0',
  long_position:   '#26a641',
  short_position:  '#f85149',
  arrow:           '#2196F3',
  arrow_mark_up:   '#26a641',
  arrow_mark_down: '#f85149',
}

const TWO_POINT = new Set([
  'trendline', 'ray', 'fib_retracement', 'rectangle', 'arrow',
])

// Three-click tools: click 1 = entry, click 2 = take profit, click 3 = stop loss
const THREE_POINT = new Set(['long_position', 'short_position'])

const HANDLE_R   = 6    // handle circle radius px
const HIT_LINE   = 10   // px from line to count as a hit
const HIT_HANDLE = HANDLE_R + 5

// ── Geometry ──────────────────────────────────────────────────────────────────

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function rayEndpoint(x1, y1, x2, y2, W, H) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return { x: x2, y: y2 }
  let t = Infinity
  if (dx > 0)  t = Math.min(t, (W - x1) / dx)
  else if (dx < 0) t = Math.min(t, -x1 / dx)
  if (dy > 0)  t = Math.min(t, (H - y1) / dy)
  else if (dy < 0) t = Math.min(t, -y1 / dy)
  return { x: x1 + dx * t, y: y1 + dy * t }
}

function arrowHead(ctx, fromX, fromY, toX, toY, size = 10) {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

// ── Hit test ──────────────────────────────────────────────────────────────────
// Returns 'p1' | 'p2' | 'body' | null

function hitTest(drawing, px, py, coords, W, H) {
  const { type, p1, p2 } = drawing
  const x1 = coords.toX(p1.time)
  const y1 = coords.toY(p1.price)

  if (x1 != null && y1 != null && Math.hypot(px - x1, py - y1) <= HIT_HANDLE) return 'p1'

  if (p2) {
    const x2 = coords.toX(p2.time)
    const y2 = coords.toY(p2.price)
    if (x2 != null && y2 != null && Math.hypot(px - x2, py - y2) <= HIT_HANDLE) return 'p2'
  }

  switch (type) {
    case 'trendline':
    case 'arrow': {
      if (x1 == null || y1 == null || !p2) return null
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) return null
      return distToSegment(px, py, x1, y1, x2, y2) < HIT_LINE ? 'body' : null
    }
    case 'ray': {
      if (x1 == null || y1 == null || !p2) return null
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) return null
      const end = rayEndpoint(x1, y1, x2, y2, W, H)
      return distToSegment(px, py, x1, y1, end.x, end.y) < HIT_LINE ? 'body' : null
    }
    case 'horizontal_line': {
      if (y1 == null) return null
      return Math.abs(py - y1) < HIT_LINE ? 'body' : null
    }
    case 'horizontal_ray': {
      if (x1 == null || y1 == null) return null
      return Math.abs(py - y1) < HIT_LINE && px >= x1 - HIT_LINE ? 'body' : null
    }
    case 'fib_retracement': {
      if (!p2) return null
      const diff = p2.price - p1.price
      for (const lvl of (drawing.fibLevels ?? DEFAULT_FIB_LEVELS)) {
        const fy = coords.toY(p1.price + diff * lvl)
        if (fy != null && Math.abs(py - fy) < HIT_LINE) return 'body'
      }
      return null
    }
    case 'rectangle': {
      if (x1 == null || y1 == null || !p2) return null
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) return null
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
      const rw = Math.abs(x2 - x1),  rh = Math.abs(y2 - y1)
      if (px >= rx - HIT_LINE && px <= rx + rw + HIT_LINE &&
          py >= ry - HIT_LINE && py <= ry + rh + HIT_LINE) return 'body'
      return null
    }
    case 'long_position':
    case 'short_position': {
      if (x1 == null || y1 == null) return null
      // p3 handle check first
      if (drawing.p3) {
        const y3 = coords.toY(drawing.p3.price)
        if (y3 != null && Math.hypot(px - x1, py - y3) <= HIT_HANDLE) return 'p3'
      }
      // Bounding box covers entry + TP + SL
      const prices = [p1.price]
      if (p2) prices.push(p2.price)
      if (drawing.p3) prices.push(drawing.p3.price)
      const x2 = p2 ? coords.toX(p2.time) : x1
      if (x2 == null) return null
      const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1)
      const yTop = coords.toY(Math.max(...prices))
      const yBot = coords.toY(Math.min(...prices))
      if (yTop == null || yBot == null) return null
      if (px >= rx - HIT_LINE && px <= rx + rw + HIT_LINE &&
          py >= yTop - HIT_LINE && py <= yBot + HIT_LINE) return 'body'
      return null
    }
    case 'arrow_mark_up':
    case 'arrow_mark_down':
      if (x1 == null || y1 == null) return null
      return Math.hypot(px - x1, py - y1) < 20 ? 'body' : null
    default: return null
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderHandles(ctx, drawing, coords) {
  const points = [drawing.p1]
  if (drawing.p2) points.push(drawing.p2)
  if (drawing.p3) points.push(drawing.p3)
  const color = drawing.style?.color ?? TOOL_COLOR[drawing.type] ?? '#2196F3'

  for (const p of points) {
    const x = coords.toX(p.time)
    const y = coords.toY(p.price)
    if (x == null || y == null) continue
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2)
    ctx.fillStyle   = '#0d1117'
    ctx.strokeStyle = color
    ctx.lineWidth   = 2
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

// Draw a thick translucent glow behind a selected drawing
function renderSelectionGlow(ctx, drawing, coords, W, H) {
  const { type, p1, p2, fibLevels = DEFAULT_FIB_LEVELS } = drawing
  const x1 = coords.toX(p1.time)
  const y1 = coords.toY(p1.price)
  if (x1 == null || y1 == null) return

  ctx.save()
  ctx.strokeStyle = '#58a6ff'
  ctx.fillStyle   = '#58a6ff'
  ctx.lineWidth   = 7
  ctx.globalAlpha = 0.25

  switch (type) {
    case 'trendline':
    case 'arrow': {
      if (!p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      break
    }
    case 'ray': {
      if (!p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const end = rayEndpoint(x1, y1, x2, y2, W, H)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(end.x, end.y); ctx.stroke()
      break
    }
    case 'horizontal_line':
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.stroke()
      break
    case 'horizontal_ray':
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(W, y1); ctx.stroke()
      break
    case 'fib_retracement': {
      if (!p2) break
      const diff = p2.price - p1.price
      for (const lvl of fibLevels) {
        const fy = coords.toY(p1.price + diff * lvl)
        if (fy != null) { ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke() }
      }
      break
    }
    case 'rectangle': {
      if (!p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
      ctx.strokeRect(rx, ry, Math.abs(x2 - x1), Math.abs(y2 - y1))
      break
    }
    case 'long_position':
    case 'short_position': {
      if (!p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const prices = [p1.price, p2.price]
      if (drawing.p3) prices.push(drawing.p3.price)
      const rx   = Math.min(x1, x2)
      const rw   = Math.abs(x2 - x1)
      const yTop = coords.toY(Math.max(...prices))
      const yBot = coords.toY(Math.min(...prices))
      if (yTop != null && yBot != null)
        ctx.strokeRect(rx, yTop, rw, yBot - yTop)
      break
    }
    case 'arrow_mark_up': {
      const s = 10
      ctx.beginPath()
      ctx.moveTo(x1, y1 + s * 1.5); ctx.lineTo(x1 - s, y1 + s * 3); ctx.lineTo(x1 + s, y1 + s * 3)
      ctx.closePath(); ctx.fill()
      break
    }
    case 'arrow_mark_down': {
      const s = 10
      ctx.beginPath()
      ctx.moveTo(x1, y1 - s * 1.5); ctx.lineTo(x1 - s, y1 - s * 3); ctx.lineTo(x1 + s, y1 - s * 3)
      ctx.closePath(); ctx.fill()
      break
    }
    default: break
  }
  ctx.restore()
}

function renderDrawing(ctx, drawing, coords, W, H, preview = false) {
  const { type, p1, p2, style = {}, fibLevels = DEFAULT_FIB_LEVELS } = drawing
  const color     = style.color     ?? TOOL_COLOR[type] ?? '#2196F3'
  const lineWidth = style.lineWidth ?? 2

  const x1 = coords.toX(p1.time)
  const y1 = coords.toY(p1.price)

  ctx.save()
  ctx.globalAlpha  = preview ? 0.65 : 1
  ctx.strokeStyle  = color
  ctx.fillStyle    = color
  ctx.lineWidth    = lineWidth
  ctx.font         = '11px sans-serif'

  switch (type) {
    case 'trendline': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      break
    }
    case 'ray': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const end = rayEndpoint(x1, y1, x2, y2, W, H)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(end.x, end.y); ctx.stroke()
      break
    }
    case 'horizontal_line': {
      if (y1 == null) break
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.stroke()
      ctx.globalAlpha = preview ? 0.5 : 0.85
      ctx.fillText(p1.price.toFixed(5), W - 68, y1 - 3)
      break
    }
    case 'horizontal_ray': {
      if (x1 == null || y1 == null) break
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(W, y1); ctx.stroke()
      break
    }
    case 'fib_retracement': {
      if (!p2) break
      const priceDiff = p2.price - p1.price
      fibLevels.forEach((lvl) => {
        const price = p1.price + priceDiff * lvl
        const fy = coords.toY(price)
        if (fy == null) return
        ctx.globalAlpha = preview ? 0.45 : (lvl === 0 || lvl === 1 ? 0.9 : 0.7)
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke()
        ctx.globalAlpha = preview ? 0.4 : 0.85
        ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${price.toFixed(5)}`, 4, fy - 3)
      })
      const x2 = coords.toX(p2.time)
      if (x1 != null && x2 != null) {
        const yTop = coords.toY(Math.max(p1.price, p2.price))
        const yBot = coords.toY(Math.min(p1.price, p2.price))
        if (yTop != null && yBot != null) {
          ctx.globalAlpha = preview ? 0.25 : 0.3
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(x1, yTop); ctx.lineTo(x1, yBot); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(x2, yTop); ctx.lineTo(x2, yBot); ctx.stroke()
        }
      }
      break
    }
    case 'rectangle': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
      const rw = Math.abs(x2 - x1),  rh = Math.abs(y2 - y1)
      ctx.globalAlpha = preview ? 0.1 : 0.12
      ctx.fillRect(rx, ry, rw, rh)
      ctx.globalAlpha = preview ? 0.65 : 1
      ctx.strokeRect(rx, ry, rw, rh)
      break
    }
    case 'long_position': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1)
      const entryY = y1
      const tpY    = Math.min(y1, y2)   // take profit — above entry (smaller y)

      // Take-profit zone (green)
      ctx.fillStyle   = '#26a641'; ctx.strokeStyle = '#26a641'
      ctx.globalAlpha = preview ? 0.12 : 0.18
      ctx.fillRect(rx, tpY, rw, entryY - tpY)
      ctx.globalAlpha = preview ? 0.65 : 1
      ctx.strokeRect(rx, tpY, rw, entryY - tpY)
      ctx.beginPath(); ctx.moveTo(rx, entryY); ctx.lineTo(rx + rw, entryY); ctx.stroke()
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#26a641'
      ctx.globalAlpha = preview ? 0.65 : 0.9
      ctx.fillText('TP  ' + p2.price.toFixed(5), rx + 4, tpY + 14)

      // Stop-loss zone (red) — only when p3 is set
      const p3 = drawing.p3
      if (p3) {
        const slY = coords.toY(p3.price)
        if (slY != null) {
          const slBottom = Math.max(entryY, slY)
          const slTop    = Math.min(entryY, slY)
          ctx.fillStyle   = '#f85149'; ctx.strokeStyle = '#f85149'
          ctx.globalAlpha = preview ? 0.12 : 0.18
          ctx.fillRect(rx, slTop, rw, slBottom - slTop)
          ctx.globalAlpha = preview ? 0.65 : 1
          ctx.strokeRect(rx, slTop, rw, slBottom - slTop)
          ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#f85149'
          ctx.globalAlpha = preview ? 0.65 : 0.9
          ctx.fillText('SL  ' + p3.price.toFixed(5), rx + 4, slBottom - 4)
        }
      }

      // Entry label
      ctx.fillStyle = '#e6edf3'; ctx.strokeStyle = '#e6edf3'
      ctx.globalAlpha = preview ? 0.65 : 0.9
      ctx.fillText('Entry  ' + p1.price.toFixed(5), rx + 4, entryY - 4)
      break
    }
    case 'short_position': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1)
      const entryY = y1
      const tpY    = Math.max(y1, y2)   // take profit — below entry (larger y)

      // Take-profit zone (green)
      ctx.fillStyle   = '#26a641'; ctx.strokeStyle = '#26a641'
      ctx.globalAlpha = preview ? 0.12 : 0.18
      ctx.fillRect(rx, entryY, rw, tpY - entryY)
      ctx.globalAlpha = preview ? 0.65 : 1
      ctx.strokeRect(rx, entryY, rw, tpY - entryY)
      ctx.beginPath(); ctx.moveTo(rx, entryY); ctx.lineTo(rx + rw, entryY); ctx.stroke()
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#26a641'
      ctx.globalAlpha = preview ? 0.65 : 0.9
      ctx.fillText('TP  ' + p2.price.toFixed(5), rx + 4, tpY - 4)

      // Stop-loss zone (red)
      const p3 = drawing.p3
      if (p3) {
        const slY = coords.toY(p3.price)
        if (slY != null) {
          const slTop    = Math.min(entryY, slY)
          const slBottom = Math.max(entryY, slY)
          ctx.fillStyle   = '#f85149'; ctx.strokeStyle = '#f85149'
          ctx.globalAlpha = preview ? 0.12 : 0.18
          ctx.fillRect(rx, slTop, rw, slBottom - slTop)
          ctx.globalAlpha = preview ? 0.65 : 1
          ctx.strokeRect(rx, slTop, rw, slBottom - slTop)
          ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#f85149'
          ctx.globalAlpha = preview ? 0.65 : 0.9
          ctx.fillText('SL  ' + p3.price.toFixed(5), rx + 4, slTop + 14)
        }
      }

      // Entry label
      ctx.fillStyle = '#e6edf3'; ctx.strokeStyle = '#e6edf3'
      ctx.globalAlpha = preview ? 0.65 : 0.9
      ctx.fillText('Entry  ' + p1.price.toFixed(5), rx + 4, entryY - 4)
      break
    }
    case 'arrow': {
      if (x1 == null || y1 == null || !p2) break
      const x2 = coords.toX(p2.time), y2 = coords.toY(p2.price)
      if (x2 == null || y2 == null) break
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      arrowHead(ctx, x1, y1, x2, y2)
      break
    }
    case 'arrow_mark_up': {
      if (x1 == null || y1 == null) break
      const s = 8
      ctx.beginPath()
      ctx.moveTo(x1, y1 + s * 1.5)
      ctx.lineTo(x1 - s, y1 + s * 3)
      ctx.lineTo(x1 + s, y1 + s * 3)
      ctx.closePath(); ctx.fill()
      break
    }
    case 'arrow_mark_down': {
      if (x1 == null || y1 == null) break
      const s = 8
      ctx.beginPath()
      ctx.moveTo(x1, y1 - s * 1.5)
      ctx.lineTo(x1 - s, y1 - s * 3)
      ctx.lineTo(x1 + s, y1 - s * 3)
      ctx.closePath(); ctx.fill()
      break
    }
    default: break
  }
  ctx.restore()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DrawingCanvas({
  chartRef,
  seriesRef,
  tool,
  drawings,
  fibLevels,
  onDrawingAdd,
  onDrawingUpdate,
  onDrawingDelete,
  onToolChange,
}) {
  const canvasRef = useRef(null)
  const dimRef    = useRef({ w: 0, h: 0 })
  const rafRef    = useRef(null)

  // All mutable state — no React state, so mouse movement never re-renders
  const drawingsRef  = useRef(drawings)
  const toolRef      = useRef(tool)
  const fibRef       = useRef(fibLevels)
  const pendingRef   = useRef(null)      // first point of 2-point placement
  const mousePxRef   = useRef(null)      // { x, y } CSS pixels
  const hoveredRef   = useRef(null)      // { id, handle } | null
  const selectedRef  = useRef(null)      // id of selected drawing
  const dragRef      = useRef(null)      // active drag state
  const panningRef   = useRef(false)     // true while passing events through to chart

  // Sync props → refs
  useEffect(() => { drawingsRef.current = drawings }, [drawings])
  useEffect(() => { toolRef.current = tool; pendingRef.current = null }, [tool])
  useEffect(() => { fibRef.current = fibLevels }, [fibLevels])

  // Stable coord helpers (chartRef/seriesRef are stable refs)
  const getCoords = useCallback(() => {
    if (!chartRef.current || !seriesRef.current) return null
    return {
      toX:   (t) => chartRef.current.timeScale().timeToCoordinate(t),
      toY:   (p) => seriesRef.current.priceToCoordinate(p),
      fromX: (x) => chartRef.current.timeScale().coordinateToTime(x),
      fromY: (y) => seriesRef.current.coordinateToPrice(y),
    }
  }, [chartRef, seriesRef])

  // ── Stable render pipeline ────────────────────────────────────────────────
  // scheduleRender never changes identity → viewport subscription registers once.

  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const coords = getCoords()
      if (!coords) return
      const ctx = canvas.getContext('2d')
      const { w, h } = dimRef.current
      ctx.clearRect(0, 0, w, h)

      const ds       = drawingsRef.current
      const curTool  = toolRef.current
      const hovered  = hoveredRef.current
      const drag     = dragRef.current
      const selected = selectedRef.current
      const mp       = mousePxRef.current

      for (const d of ds) {
        const isSelected = selected === d.id
        const isActive   = hovered?.id === d.id || drag?.id === d.id
        if (isSelected) renderSelectionGlow(ctx, d, coords, w, h)
        renderDrawing(ctx, d, coords, w, h, false)
        if (isSelected || isActive) renderHandles(ctx, d, coords)
      }

      // Preview while placing
      if (pendingRef.current && mp) {
        const mTime  = coords.fromX(mp.x)
        const mPrice = coords.fromY(mp.y)
        if (mTime != null && mPrice != null) {
          if (TWO_POINT.has(curTool)) {
            renderDrawing(ctx, {
              id: '_preview', type: curTool,
              p1: pendingRef.current,
              p2: { time: mTime, price: mPrice },
              fibLevels: fibRef.current ?? DEFAULT_FIB_LEVELS,
            }, coords, w, h, true)
          } else if (THREE_POINT.has(curTool)) {
            const pending = pendingRef.current
            if (!pending.p2) {
              // Showing entry → mouse as TP preview
              renderDrawing(ctx, {
                id: '_preview', type: curTool,
                p1: pending.p1,
                p2: { time: mTime, price: mPrice },
              }, coords, w, h, true)
            } else {
              // Showing full preview with SL at mouse
              renderDrawing(ctx, {
                id: '_preview', type: curTool,
                p1: pending.p1,
                p2: pending.p2,
                p3: { time: mTime, price: mPrice },
              }, coords, w, h, true)
            }
          }
        }
      }
    })
  }, [getCoords]) // getCoords is stable → scheduleRender is stable

  // Re-render when drawings or tool prop changes
  useEffect(() => { scheduleRender() }, [drawings, tool, scheduleRender])

  // Subscribe to chart viewport — stable subscription, never re-registers
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRender)
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleRender)
  }, [chartRef, scheduleRender])

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const resize = (w, h) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width  = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      dimRef.current = { w, h }
      scheduleRender()
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) resize(e.contentRect.width, e.contentRect.height)
    })
    ro.observe(parent)
    const r = parent.getBoundingClientRect()
    if (r.width > 0) resize(r.width, r.height)
    return () => ro.disconnect()
  }, [scheduleRender])

  // Keyboard: Escape cancels placement; Delete/Backspace removes selected drawing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        pendingRef.current = null
        scheduleRender()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        // Don't fire when typing in an input/textarea
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
        e.preventDefault()
        const id = selectedRef.current
        selectedRef.current = null
        onDrawingDelete?.(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scheduleRender, onDrawingDelete])

  // Document mouseup — commits drag and restores chart panning
  useEffect(() => {
    const onUp = () => {
      if (dragRef.current) {
        const drag = dragRef.current
        dragRef.current = null
        if (drag.latestDrawing) {
          onDrawingUpdate?.(drag.latestDrawing)
        }
        scheduleRender()
      }
      if (panningRef.current) {
        panningRef.current = false
        if (canvasRef.current) canvasRef.current.style.pointerEvents = 'auto'
      }
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [onDrawingUpdate, scheduleRender])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const eventPx = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const pxToPoint = useCallback((px) => {
    const coords = getCoords()
    if (!coords || !px) return null
    const time  = coords.fromX(px.x)
    const price = coords.fromY(px.y)
    if (time == null || price == null) return null
    return { time, price }
  }, [getCoords])

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e) => {
    const px = eventPx(e)
    mousePxRef.current = px

    if (dragRef.current) {
      const drag    = dragRef.current
      const coords  = getCoords()
      if (!coords || !px) return
      const mTime  = coords.fromX(px.x)
      const mPrice = coords.fromY(px.y)
      if (mTime == null || mPrice == null) return

      const drawing = drawingsRef.current.find((d) => d.id === drag.id)
      if (!drawing) return

      let updated
      if (drag.handle === 'p1') {
        updated = { ...drawing, p1: { time: mTime, price: mPrice } }
      } else if (drag.handle === 'p2') {
        updated = { ...drawing, p2: { time: mTime, price: mPrice } }
      } else if (drag.handle === 'p3') {
        updated = { ...drawing, p3: { time: mTime, price: mPrice } }
      } else {
        // body — translate all points
        const dt = mTime  - drag.startMouse.time
        const dp = mPrice - drag.startMouse.price
        updated = {
          ...drawing,
          p1: { time: drag.startP1.time + dt, price: drag.startP1.price + dp },
          p2: drag.startP2 ? { time: drag.startP2.time + dt, price: drag.startP2.price + dp } : null,
          p3: drag.startP3 ? { time: drag.startP3.time + dt, price: drag.startP3.price + dp } : null,
        }
      }

      // Update ref immediately for smooth rendering (no React re-render during drag)
      drawingsRef.current = drawingsRef.current.map((d) => d.id === drag.id ? updated : d)
      drag.latestDrawing  = updated
      scheduleRender()
      return
    }

    const curTool = toolRef.current
    if (curTool === 'cursor') {
      const coords = getCoords()
      if (!coords || !px) return
      const { w, h } = dimRef.current
      let found = null
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const d      = drawingsRef.current[i]
        const handle = hitTest(d, px.x, px.y, coords, w, h)
        if (handle) { found = { id: d.id, handle }; break }
      }
      const prev = hoveredRef.current
      if (found?.id !== prev?.id || found?.handle !== prev?.handle) {
        hoveredRef.current = found
        // Update cursor directly on DOM (no React re-render needed)
        if (canvasRef.current) {
          canvasRef.current.style.cursor = found
            ? (found.handle === 'body' ? 'move' : 'crosshair')
            : 'default'
        }
        scheduleRender()
      }
    } else if (TWO_POINT.has(curTool) && pendingRef.current) {
      scheduleRender()
    }
  }, [getCoords, scheduleRender])

  const handleMouseLeave = useCallback(() => {
    mousePxRef.current = null
    if (!dragRef.current) {
      hoveredRef.current = null
      scheduleRender()
    }
  }, [scheduleRender])

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    const curTool = toolRef.current
    if (curTool !== 'cursor') return  // clicks handled in handleClick

    const px = eventPx(e)
    if (!px) return
    const coords = getCoords()
    if (!coords) return
    const { w, h } = dimRef.current

    // Hit test top-to-bottom
    let hit = null
    for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
      const d      = drawingsRef.current[i]
      const handle = hitTest(d, px.x, px.y, coords, w, h)
      if (handle) { hit = { drawing: d, handle }; break }
    }

    if (hit) {
      e.preventDefault()
      e.stopPropagation()
      const mp = pxToPoint(px)
      // Select this drawing
      if (selectedRef.current !== hit.drawing.id) {
        selectedRef.current = hit.drawing.id
        scheduleRender()
      }
      dragRef.current = {
        id:           hit.drawing.id,
        handle:       hit.handle,
        startMouse:   mp,
        startP1:      { ...hit.drawing.p1 },
        startP2:      hit.drawing.p2 ? { ...hit.drawing.p2 } : null,
        startP3:      hit.drawing.p3 ? { ...hit.drawing.p3 } : null,
        latestDrawing: null,
      }
    } else {
      // Click on empty space — deselect
      if (selectedRef.current) {
        selectedRef.current = null
        scheduleRender()
      }
      // Miss — pass this mousedown through to the chart for native panning
      panningRef.current = true
      const canvas = canvasRef.current
      canvas.style.pointerEvents = 'none'
      const el = document.elementFromPoint(e.clientX, e.clientY)
      canvas.style.pointerEvents = 'auto'
      if (el) {
        el.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window,
          clientX: e.clientX, clientY: e.clientY,
          screenX: e.screenX, screenY: e.screenY,
          button: e.button, buttons: e.buttons,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
          altKey: e.altKey, metaKey: e.metaKey,
        }))
      }
      // Subsequent mousemove/up go directly to chart while panning
      canvas.style.pointerEvents = 'none'
      // Restored by document mouseup handler
    }
  }, [getCoords, pxToPoint])

  const handleClick = useCallback((e) => {
    // Cursor clicks handled by mousedown/drag; drawing placement clicks here
    const curTool = toolRef.current
    if (curTool === 'cursor') return

    const px    = eventPx(e)
    const point = pxToPoint(px)
    if (!point) return

    if (!TWO_POINT.has(curTool) && !THREE_POINT.has(curTool)) {
      // Single-click tools
      onDrawingAdd({
        id:        crypto.randomUUID(),
        type:      curTool,
        p1:        point,
        p2:        null,
        style:     { color: TOOL_COLOR[curTool], lineWidth: 2 },
        fibLevels: fibRef.current ?? DEFAULT_FIB_LEVELS,
      })
      onToolChange?.('cursor')
    } else if (THREE_POINT.has(curTool)) {
      // 3-click: entry → TP → SL
      if (!pendingRef.current) {
        // Click 1: entry
        pendingRef.current = { p1: point }
        scheduleRender()
      } else if (!pendingRef.current.p2) {
        // Click 2: take profit
        pendingRef.current = { ...pendingRef.current, p2: point }
        scheduleRender()
      } else {
        // Click 3: stop loss — place drawing
        onDrawingAdd({
          id:    crypto.randomUUID(),
          type:  curTool,
          p1:    pendingRef.current.p1,
          p2:    pendingRef.current.p2,
          p3:    point,
          style: { color: TOOL_COLOR[curTool], lineWidth: 2 },
        })
        pendingRef.current = null
        onToolChange?.('cursor')
      }
    } else if (!pendingRef.current) {
      // Two-click tools: first click
      pendingRef.current = point
      scheduleRender()
    } else {
      // Two-click tools: second click
      onDrawingAdd({
        id:        crypto.randomUUID(),
        type:      curTool,
        p1:        pendingRef.current,
        p2:        point,
        style:     { color: TOOL_COLOR[curTool], lineWidth: 2 },
        fibLevels: fibRef.current ?? DEFAULT_FIB_LEVELS,
      })
      pendingRef.current = null
      onToolChange?.('cursor')
    }
  }, [pxToPoint, onDrawingAdd, onToolChange, scheduleRender])

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{
        position:      'absolute',
        top:           0,
        left:          0,
        pointerEvents: 'auto',
        cursor:        tool === 'cursor' ? 'default' : 'crosshair',
        zIndex:        10,
      }}
    />
  )
}
