import { useState, useRef } from 'react'

export default function TickerList({ tickers, activeTicker, onSelect, onAdd, onRemove, onReorder }) {
  const [input, setInput] = useState('')
  const [dragOver, setDragOver] = useState(null)
  const dragIdx = useRef(null)

  const handleAdd = () => {
    const val = input.trim().toUpperCase()
    if (!val) return
    onAdd(val)
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') handleAdd()
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
        {tickers.map((t, idx) => (
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
            >
              {t.label || t.ticker}
            </span>
            <button
              onClick={() => onRemove(t.ticker)}
              style={removeBtnStyle}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={addRowStyle}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Add ticker…"
          style={inputStyle}
        />
        <button onClick={handleAdd} style={addBtnStyle}>+</button>
      </div>

      <div style={hintStyle}>
        Use Yahoo Finance symbols<br />
        e.g. AAPL, BTC-USD, GC=F
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
  overflowY: 'auto',
}

const headerStyle = {
  padding: '10px 12px 6px',
  fontSize: 11,
  fontWeight: 700,
  color: '#6e7681',
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: '1px solid #21262d',
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

const addRowStyle = {
  display: 'flex',
  gap: 4,
  padding: '8px 10px',
  borderTop: '1px solid #21262d',
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
}

const addBtnStyle = {
  padding: '4px 8px',
  background: '#1f6feb',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  fontSize: 16,
  cursor: 'pointer',
  lineHeight: 1,
}

const hintStyle = {
  padding: '6px 10px 10px',
  fontSize: 10,
  color: '#484f58',
  lineHeight: 1.5,
}
