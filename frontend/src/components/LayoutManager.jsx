/**
 * LayoutManager — dropdown-style panel for creating, renaming, switching,
 * and deleting named drawing layouts.
 */
import { useState, useRef, useEffect } from 'react'

export default function LayoutManager({
  layouts,
  activeLayoutId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) {
  const [open, setOpen]           = useState(false)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [renaming, setRenaming]   = useState(null)   // layout id being renamed
  const [renameVal, setRenameVal] = useState('')
  const panelRef                  = useRef(null)
  const newInputRef               = useRef(null)
  const renameInputRef            = useRef(null)

  const activeLayout = layouts.find((l) => l.id === activeLayoutId)

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Auto-focus new name input
  useEffect(() => {
    if (creating) newInputRef.current?.focus()
  }, [creating])

  useEffect(() => {
    if (renaming != null) renameInputRef.current?.focus()
  }, [renaming])

  const submitCreate = () => {
    const name = newName.trim()
    if (!name) return
    onCreate(name)
    setNewName('')
    setCreating(false)
  }

  const submitRename = (id) => {
    const name = renameVal.trim()
    if (name) onRename(id, name)
    setRenaming(null)
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={triggerStyle(open)}
        title="Manage drawing layouts"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
             width="13" height="13" style={{ marginRight: 4 }}>
          <rect x="1" y="2" width="14" height="3" rx="1" />
          <rect x="1" y="7" width="14" height="3" rx="1" />
          <rect x="1" y="12" width="14" height="3" rx="1" />
        </svg>
        {activeLayout ? activeLayout.name : 'Layout'}
        <svg viewBox="0 0 10 6" fill="currentColor" width="9" height="9" style={{ marginLeft: 4 }}>
          <path d={open ? 'M0 6L5 0L10 6Z' : 'M0 0L5 6L10 0Z'} />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Drawing Layouts</div>

          {/* Layout list */}
          {layouts.map((l) => (
            <div key={l.id} style={rowStyle(l.id === activeLayoutId)}>
              {renaming === l.id ? (
                <input
                  ref={renameInputRef}
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(l.id)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => submitRename(l.id)}
                  style={inlineInputStyle}
                />
              ) : (
                <span
                  style={rowLabelStyle}
                  onClick={() => { onSelect(l.id); setOpen(false) }}
                >
                  {l.id === activeLayoutId && (
                    <svg viewBox="0 0 8 8" fill="#58a6ff" width="8" height="8" style={{ marginRight: 5 }}>
                      <circle cx="4" cy="4" r="4" />
                    </svg>
                  )}
                  {l.name}
                </span>
              )}

              <div style={{ display: 'flex', gap: 2 }}>
                {/* Rename */}
                <button
                  title="Rename"
                  style={iconBtnStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(l.id)
                    setRenameVal(l.name)
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="13" height="13">
                    <path d="M11 2l3 3-8 8H3v-3L11 2z" />
                  </svg>
                </button>
                {/* Delete — prevent deleting the last layout */}
                {layouts.length > 1 && (
                  <button
                    title="Delete"
                    style={{ ...iconBtnStyle, color: '#f85149' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(l.id)
                    }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="13" height="13">
                      <path d="M3 3l10 10M13 3L3 13" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* New layout row */}
          {creating ? (
            <div style={{ padding: '4px 8px', display: 'flex', gap: 4 }}>
              <input
                ref={newInputRef}
                placeholder="Layout name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate()
                  if (e.key === 'Escape') { setCreating(false); setNewName('') }
                }}
                style={inlineInputStyle}
              />
              <button style={smallBtnStyle('#26a641')} onClick={submitCreate}>✓</button>
              <button style={smallBtnStyle('#8b949e')} onClick={() => { setCreating(false); setNewName('') }}>✕</button>
            </div>
          ) : (
            <button style={newBtnStyle} onClick={() => setCreating(true)}>
              + New layout
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const triggerStyle = (open) => ({
  display:        'flex',
  alignItems:     'center',
  gap:            0,
  padding:        '4px 8px',
  background:     open ? '#21262d' : 'none',
  border:         '1px solid #30363d',
  borderRadius:   6,
  color:          '#c9d1d9',
  fontSize:       12,
  cursor:         'pointer',
  whiteSpace:     'nowrap',
  userSelect:     'none',
})

const panelStyle = {
  position:     'absolute',
  top:          'calc(100% + 4px)',
  left:         0,
  zIndex:       100,
  minWidth:     220,
  background:   '#161b22',
  border:       '1px solid #30363d',
  borderRadius:  8,
  boxShadow:    '0 8px 24px rgba(0,0,0,0.5)',
  overflow:     'hidden',
}

const panelHeaderStyle = {
  padding:      '8px 12px 4px',
  fontSize:     11,
  color:        '#6e7681',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid #21262d',
}

const rowStyle = (active) => ({
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '5px 8px 5px 12px',
  background:     active ? '#21262d' : 'transparent',
  cursor:         'pointer',
})

const rowLabelStyle = {
  flex:       1,
  display:    'flex',
  alignItems: 'center',
  fontSize:   13,
  color:      '#c9d1d9',
  overflow:   'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const iconBtnStyle = {
  width:      22,
  height:     22,
  display:    'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border:     'none',
  borderRadius: 4,
  color:      '#6e7681',
  cursor:     'pointer',
  padding:    0,
}

const inlineInputStyle = {
  flex:         1,
  background:   '#0d1117',
  border:       '1px solid #388bfd',
  borderRadius:  4,
  color:        '#c9d1d9',
  fontSize:     13,
  padding:      '2px 6px',
  outline:      'none',
  minWidth:     0,
}

const newBtnStyle = {
  width:        '100%',
  padding:      '7px 12px',
  background:   'none',
  border:       'none',
  borderTop:    '1px solid #21262d',
  color:        '#58a6ff',
  fontSize:     12,
  cursor:       'pointer',
  textAlign:    'left',
}

const smallBtnStyle = (color) => ({
  background: 'none',
  border:     `1px solid ${color}`,
  borderRadius: 4,
  color,
  fontSize:   12,
  cursor:     'pointer',
  padding:    '2px 5px',
})
