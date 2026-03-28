const BASE = '/api'

/**
 * Compute a sensible [start, end] date range for a given interval and center date.
 * Returns ISO date strings.
 */
export function windowForInterval(interval, centerDate) {
  const center = new Date(centerDate)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const add = (d, days) => new Date(d.getTime() + days * 86400_000)
  const sub = (d, days) => new Date(d.getTime() - days * 86400_000)

  switch (interval) {
    case '5m':  return [fmt(sub(center, 7)),    fmt(add(center, 2))]
    case '15m': return [fmt(sub(center, 30)),   fmt(add(center, 2))]
    case '1h':  return [fmt(sub(center, 180)),  fmt(add(center, 2))]
    case '4h':  return [fmt(sub(center, 730)),  fmt(add(center, 2))]
    case '1d':  return [fmt(sub(center, 1825)), fmt(add(center, 2))]
    case '1wk': return [fmt(sub(center, 3650)), fmt(add(center, 14))]
    case '1mo': return [fmt(sub(center, 7300)), fmt(add(center, 60))]
    case '1y':  return [fmt(sub(center, 18250)),fmt(add(center, 365))]
    default:    return [fmt(sub(center, 365)),  fmt(add(center, 2))]
  }
}

export async function fetchOHLC(symbol, interval, start, end) {
  const params = new URLSearchParams({ symbol, interval, start, end })
  const res = await fetch(`${BASE}/ohlc?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function fetchSymbols() {
  const res = await fetch(`${BASE}/symbols`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
