const BASE = '/api'

/**
 * Compute a sensible [start, end] date range for a given interval and center date.
 * Returns ISO date strings.
 */
export function windowForInterval(interval, centerDate) {
  const center = new Date(centerDate)
  const now = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)

  const add = (d, days) => new Date(d.getTime() + days * 86400_000)
  const sub = (d, days) => new Date(d.getTime() - days * 86400_000)
  // Always extend end to at least today so historical dates still load recent bars
  const endAt = (d) => fmt(d > now ? d : add(now, 1))

  switch (interval) {
    case '5m':  return [fmt(sub(center, 7)),     endAt(add(center, 2))]
    case '15m': return [fmt(sub(center, 30)),    endAt(add(center, 2))]
    case '1h':  return [fmt(sub(center, 180)),   endAt(add(center, 2))]
    case '4h':  return [fmt(sub(center, 730)),   endAt(add(center, 2))]
    case '1d':  return [fmt(sub(center, 1825)),  endAt(add(center, 2))]
    case '1wk': return [fmt(sub(center, 3650)),  endAt(add(center, 14))]
    case '1mo': return [fmt(sub(center, 7300)),  endAt(add(center, 60))]
    case '1y':  return [fmt(sub(center, 18250)), endAt(add(center, 365))]
    default:    return [fmt(sub(center, 365)),   endAt(add(center, 2))]
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

export async function fetchWatchlist() {
  const res = await fetch(`${BASE}/watchlist`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function saveWatchlist(symbols) {
  const res = await fetch(`${BASE}/watchlist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
