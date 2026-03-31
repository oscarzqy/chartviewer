import { useState, useRef, useEffect } from 'react'
import { searchTickers } from '../api.js'

function tickerDisplay(ticker) {
  if (ticker.startsWith('POLYGON:')) return ticker.slice('POLYGON:'.length)
  if (ticker.startsWith('YAHOO:')) return ticker.slice('YAHOO:'.length)
  return ticker
}

function sourceOfTicker(ticker) {
  return ticker.startsWith('POLYGON:') ? 'polygon' : 'yahoo'
}

export default function TickerList({ tickers, activeTicker, onSelect, onAdd, onRemove, onReorder }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [hoveredResult, setHoveredResult] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const dragIdx = useRef(null)
  const searchTimer = useRef(null)
  const containerRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleQueryChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(searchTimer.current)
    if (!val.trim()) {
      setResults([])
      setShowDropdown(false)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await searchTickers(val.trim())
        setResults(data.results)
        setShowDropdown(data.results.length > 0)
      } catch {
        setResults([])
        setShowDropdown(false)
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const handleResultClick = (result) => {
    onAdd({ ticker: result.ticker, label: result.label || tickerDisplay(result.ticker) })
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') {
      if (showDropdown && results.length > 0) {
        handleResultClick(results[0])
      } else if (query.trim() && !searching) {
        // Manual add as bare Yahoo ticker
        const val = query.trim().toUpperCase()
        onAdd({ ticker: val, label: val })
        setQuery('')
      }
    }
    if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const handleDragStart = (e, idx) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(idx)
  }

  const handleDrop = (e, idx) => {
    e.preventDefault()
    setDragOver(null)
    if (dragIdx.current === null || dragIdx.current === idx) return
    const reordered = [...tickers]
    const [moved] = reordered.splice(dragIdx.current, 1)
    reordered.splice(idx, 0, moved)
    dragIdx.current = null
    onReorder(reordered)
  }

  const handleDragEnd = () => {
    dragIdx.current = null
    setDragOver(null)
  }

  return (
    <div style={sidebarStyle}>
      <div style={headerStyle}>Watchlist</div>

      <div style={listStyle}>
        {tickers.map((t, idx) => {
          const src = sourceOfTicker(t.ticker)
          const display = t.label || tickerDisplay(t.ticker)
          return (
            <div
              key={t.ticker}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              style={rowStyle(t.ticker === activeTicker, dragOver === idx)}
            >
              <span style={dragHandleStyle} title="Drag to reorder">⠿</span>
              <span
                onClick={() => onSelect(t.ticker)}
                style={tickerLabelStyle}
                title={t.ticker}
              >
                {display}
              </span>
              {src === 'polygon' && (
                <span style={pgBadgeStyle} title="Polygon.io">PG</span>
              )}
              <button onClick={() => onRemove(t.ticker)} style={removeBtnStyle} title="Remove">×</button>
            </div>
          )
        })}
      </div>

      {/* Search input + dropdown */}
      <div ref={containerRef} style={searchWrapStyle}>
        <div style={inputRowStyle}>
          <input
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKey}
            onFocus={() => results.length > 0 && setShowDropdown(true)}
            placeholder="Search ticker…"
            style={inputStyle}
          />
          {searching && <span style={spinnerStyle}>⟳</span>}
        </div>

        {showDropdown && (
          <div style={dropdownStyle}>
            {results.map((r) => (
              <div
                key={r.ticker}
                onMouseDown={() => handleResultClick(r)}
                onMouseEnter={() => setHoveredResult(r.ticker)}
                onMouseLeave={() => setHoveredResult(null)}
                style={resultRowStyle(hoveredResult === r.ticker)}
              >
                <span style={resultTickerStyle}>{tickerDisplay(r.ticker)}</span>
                <span style={resultNameStyle}>{r.label}</span>
                <span style={r.source === 'polygon' ? pgResultBadgeStyle : yfResultBadgeStyle}>
                  {r.source === 'polygon' ? 'PG' : 'YF'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const sidebarStyle = {
  width: 160,
  minWidth: 140,
  background: '#161b22',
  borderRight: '1px solid #30363d',
  display: 'flex',
  flexDirection: 'column',
}

const headerStyle = {
  padding: '10px 12px 6px',
  fontSize: 11,
  fontWeight: 700,
  color: '#6e7681',
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: '1px solid #21262d',
  flexShrink: 0,
}

const listStyle = {
  flex: 1,
  overflowY: 'auto',
}

const rowStyle = (active, isDragTarget) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px 6px 6px',
  background: isDragTarget ? '#2d333b' : active ? '#1f2937' : 'transparent',
  borderLeft: `3px solid ${active ? '#1f6feb' : 'transparent'}`,
  borderTop: isDragTarget ? '2px solid #1f6feb' : '2px solid transparent',
  cursor: 'grab',
  userSelect: 'none',
})

const dragHandleStyle = {
  color: '#484f58',
  fontSize: 14,
  cursor: 'grab',
  flexShrink: 0,
}

const tickerLabelStyle = {
  flex: 1,
  fontSize: 13,
  color: '#c9d1d9',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}

const pgBadgeStyle = {
  fontSize: 9,
  fontWeight: 700,
  color: '#8b5cf6',
  letterSpacing: 0.5,
  flexShrink: 0,
}

const removeBtnStyle = {
  background: 'none',
  border: 'none',
  color: '#6e7681',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  flexShrink: 0,
}

const searchWrapStyle = {
  position: 'relative',
  borderTop: '1px solid #21262d',
  padding: '8px 10px',
  flexShrink: 0,
}

const inputRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const inputStyle = {
  flex: 1,
  padding: '4px 6px',
  fontSize: 12,
  background: '#0d1117',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 4,
  minWidth: 0,
  outline: 'none',
}

const spinnerStyle = {
  color: '#6e7681',
  fontSize: 14,
  animation: 'spin 1s linear infinite',
  flexShrink: 0,
}

// Dropdown escapes the sidebar's width — positioned relative to searchWrapStyle
const dropdownStyle = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  width: 300,
  maxHeight: 320,
  overflowY: 'auto',
  background: '#1c2128',
  border: '1px solid #30363d',
  borderRadius: 6,
  zIndex: 200,
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
}

const resultRowStyle = (hovered) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 10px',
  cursor: 'pointer',
  borderBottom: '1px solid #21262d',
  background: hovered ? '#2d333b' : 'transparent',
})

const resultTickerStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: '#e6edf3',
  flexShrink: 0,
  minWidth: 60,
}

const resultNameStyle = {
  flex: 1,
  fontSize: 11,
  color: '#8b949e',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const yfResultBadgeStyle = {
  fontSize: 9,
  fontWeight: 700,
  color: '#3fb950',
  letterSpacing: 0.5,
  flexShrink: 0,
}

const pgResultBadgeStyle = {
  fontSize: 9,
  fontWeight: 700,
  color: '#8b5cf6',
  letterSpacing: 0.5,
  flexShrink: 0,
}
