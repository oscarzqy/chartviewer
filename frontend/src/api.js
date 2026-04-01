const API = '/api'
const AUTH = '/auth'

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

function getAuthHeader() {
  const token = localStorage.getItem('cv_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, ...getAuthHeader() },
  })
  if (res.status === 401) {
    const err = new Error('Session expired — please sign in again')
    err.status = 401
    throw err
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const res = await fetch(`${AUTH}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function register(username, password, invite_token) {
  const res = await fetch(`${AUTH}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, invite_token }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function fetchMe() {
  return request(`${AUTH}/me`)
}

export async function createInvite() {
  return request(`${AUTH}/invite`, { method: 'POST' })
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchTickers(q) {
  const params = new URLSearchParams({ q })
  return request(`${API}/search?${params}`)
}

// ── Sources ───────────────────────────────────────────────────────────────────

export async function fetchSources() {
  return request(`${API}/sources`)
}

// ── OHLC ──────────────────────────────────────────────────────────────────────

export async function fetchOHLC(symbol, interval, start, end) {
  const params = new URLSearchParams({ symbol, interval, start, end })
  return request(`${API}/ohlc?${params}`)
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export async function fetchWatchlist() {
  return request(`${API}/watchlist`)
}

export async function saveWatchlist(symbols) {
  return request(`${API}/watchlist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function fetchPreferences() {
  return request(`${API}/preferences`)
}

export async function savePreferences(prefs) {
  return request(`${API}/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
}

// ── Layouts ───────────────────────────────────────────────────────────────────

export async function fetchLayouts() {
  return request(`${API}/layouts`)
}

export async function createLayout(name) {
  return request(`${API}/layouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function updateLayout(id, { name, drawings }) {
  const body = {}
  if (name !== undefined) body.name = name
  if (drawings !== undefined) body.drawings = typeof drawings === 'string' ? drawings : JSON.stringify(drawings)
  return request(`${API}/layouts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteLayout(id) {
  return request(`${API}/layouts/${id}`, { method: 'DELETE' })
}
