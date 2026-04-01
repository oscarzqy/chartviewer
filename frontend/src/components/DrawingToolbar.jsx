/**
 * DrawingToolbar — vertical sidebar with drawing tool buttons + clear button.
 * Each tool is an SVG icon with a tooltip.
 */

const TOOLS = [
  {
    id: 'cursor',
    label: 'Cursor (no drawing)',
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 1l8 8-3.5.5L7 13l-1.5-4L1 9.5z" />
      </svg>
    ),
  },
  {
    id: 'trendline',
    label: 'Trend Line',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="2" y1="14" x2="14" y2="2" />
        <circle cx="2" cy="14" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="14" cy="2" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'ray',
    label: 'Ray',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="2" y1="14" x2="15" y2="1" />
        <circle cx="2" cy="14" r="1.5" fill="currentColor" stroke="none" />
        <polygon points="15,1 11,2 14,5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'horizontal_line',
    label: 'Horizontal Line',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="1" y1="8" x2="15" y2="8" />
        <line x1="1" y1="6" x2="1" y2="10" />
        <line x1="15" y1="6" x2="15" y2="10" />
      </svg>
    ),
  },
  {
    id: 'horizontal_ray',
    label: 'Horizontal Ray',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="2" cy="8" r="1.5" fill="currentColor" stroke="none" />
        <line x1="3.5" y1="8" x2="15" y2="8" />
        <polygon points="15,8 11,6 11,10" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'fib_retracement',
    label: 'Fib Retracement',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <line x1="1" y1="3"  x2="15" y2="3"  />
        <line x1="1" y1="6"  x2="15" y2="6"  strokeDasharray="2 1" />
        <line x1="1" y1="8"  x2="15" y2="8"  strokeDasharray="2 1" />
        <line x1="1" y1="10" x2="15" y2="10" strokeDasharray="2 1" />
        <line x1="1" y1="13" x2="15" y2="13" />
      </svg>
    ),
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="10" />
      </svg>
    ),
  },
  {
    id: 'long_position',
    label: 'Long Position',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="7" fill="#26a641" fillOpacity="0.18" stroke="#26a641" strokeWidth="1.2" />
        <line x1="1" y1="11" x2="15" y2="11" stroke="#26a641" strokeWidth="1.5" />
        <polygon points="8,2 5,6 11,6" fill="#26a641" />
      </svg>
    ),
  },
  {
    id: 'short_position',
    label: 'Short Position',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="1" y="5" width="14" height="7" fill="#f85149" fillOpacity="0.18" stroke="#f85149" strokeWidth="1.2" />
        <line x1="1" y1="5" x2="15" y2="5" stroke="#f85149" strokeWidth="1.5" />
        <polygon points="8,14 5,10 11,10" fill="#f85149" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    label: 'Arrow',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="3" y1="13" x2="13" y2="3" />
        <polygon points="13,3 9,5 11,7" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'arrow_mark_up',
    label: 'Arrow Mark Up',
    icon: (
      <svg viewBox="0 0 16 16" fill="#26a641">
        <polygon points="8,3 3,10 13,10" />
      </svg>
    ),
  },
  {
    id: 'arrow_mark_down',
    label: 'Arrow Mark Down',
    icon: (
      <svg viewBox="0 0 16 16" fill="#f85149">
        <polygon points="8,13 3,6 13,6" />
      </svg>
    ),
  },
]

export default function DrawingToolbar({ activeTool, onToolChange, onClearAll }) {
  return (
    <div style={containerStyle}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => onToolChange(t.id)}
          style={btnStyle(t.id === activeTool)}
        >
          <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center' }}>
            {t.icon}
          </span>
        </button>
      ))}

      {/* Separator */}
      <div style={separatorStyle} />

      {/* Clear all drawings */}
      <button
        title="Clear all drawings"
        onClick={onClearAll}
        style={btnStyle(false, '#f85149')}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="18" height="18">
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="13" y1="3" x2="3" y2="13" />
        </svg>
      </button>
    </div>
  )
}

const containerStyle = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'center',
  gap:            2,
  padding:        '6px 4px',
  background:     '#161b22',
  borderRight:    '1px solid #30363d',
  overflowY:      'auto',
  userSelect:     'none',
}

const btnStyle = (active, hoverColor) => ({
  width:           32,
  height:          32,
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  padding:         0,
  background:      active ? '#21262d' : 'none',
  border:          active ? '1px solid #388bfd' : '1px solid transparent',
  borderRadius:    6,
  color:           active ? '#58a6ff' : '#8b949e',
  cursor:          'pointer',
  flexShrink:      0,
})

const separatorStyle = {
  width:        24,
  height:       1,
  background:   '#30363d',
  margin:       '4px 0',
}
