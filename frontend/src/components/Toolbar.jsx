const INTERVALS = ['5m', '15m', '1h', '4h', '1d', '1wk', '1mo', '1y']

export default function Toolbar({ interval, onIntervalChange, date, onDateChange, onReplayClick, replayMode }) {
  return (
    <div style={toolbarStyle}>
      {/* Interval buttons */}
      <div style={groupStyle}>
        {INTERVALS.map((tf) => (
          <button
            key={tf}
            onClick={() => onIntervalChange(tf)}
            style={btnStyle(tf === interval)}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Date picker */}
      <div style={groupStyle}>
        <label style={labelStyle}>Go to</label>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          style={dateInputStyle}
        />
      </div>

      {/* Replay */}
      <div style={groupStyle}>
        <button
          onClick={onReplayClick}
          style={btnStyle(replayMode !== 'idle')}
          title="Replay mode"
        >
          ▶ Replay
        </button>
      </div>
    </div>
  )
}

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '8px 12px',
  background: '#161b22',
  borderBottom: '1px solid #30363d',
  flexWrap: 'wrap',
}

const groupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const labelStyle = {
  color: '#6e7681',
  fontSize: 12,
  marginRight: 4,
}

const btnStyle = (active) => ({
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: active ? 700 : 400,
  background: active ? '#1f6feb' : '#21262d',
  color: active ? '#fff' : '#c9d1d9',
  border: '1px solid',
  borderColor: active ? '#1f6feb' : '#30363d',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
})

const dateInputStyle = {
  padding: '4px 8px',
  fontSize: 12,
  background: '#21262d',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
}
