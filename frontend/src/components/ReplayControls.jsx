const SPEEDS = [1, 2, 5, 10]

export default function ReplayControls({
  replayMode,      // 'cut' | 'playing' | 'paused'
  replaySpeed,
  currentBarDate,
  onExit,
  onCut,
  onStep,
  onPlayPause,
  onSpeedChange,
  onRandomDate,
}) {
  const isPlaying = replayMode === 'playing'
  const isCutMode = replayMode === 'cut'

  return (
    <div style={barStyle}>
      <button onClick={onExit} style={exitBtnStyle}>
        Exit Replay
      </button>

      <div style={dividerStyle} />

      <button
        onClick={onCut}
        style={iconBtnStyle(isCutMode)}
        title="Reposition cut (click a bar to restart from there)"
      >
        ✂ Cut
      </button>

      <button
        onClick={onRandomDate}
        style={iconBtnStyle(false)}
        title="Jump to a random date"
      >
        🎲 Random
      </button>

      <div style={dividerStyle} />

      <button
        onClick={onStep}
        disabled={isPlaying}
        style={iconBtnStyle(false, isPlaying)}
        title="Step forward one bar"
      >
        Step ▶
      </button>

      <button
        onClick={onPlayPause}
        style={iconBtnStyle(isPlaying)}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      <div style={dividerStyle} />

      <span style={labelStyle}>Speed:</span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => onSpeedChange(s)}
          style={speedBtnStyle(s === replaySpeed)}
        >
          {s}x
        </button>
      ))}

      {currentBarDate && (
        <>
          <div style={dividerStyle} />
          <span style={dateLabelStyle}>📅 {currentBarDate}</span>
        </>
      )}
    </div>
  )
}

const barStyle = {
  position:       'absolute',
  bottom:         0,
  left:           0,
  right:          0,
  zIndex:         30,
  display:        'flex',
  alignItems:     'center',
  gap:            6,
  padding:        '6px 12px',
  background:     '#161b22',
  borderTop:      '1px solid #30363d',
  flexWrap:       'wrap',
}

const dividerStyle = {
  width:        1,
  height:       16,
  background:   '#30363d',
  margin:       '0 4px',
  flexShrink:   0,
}

const baseBtnStyle = {
  padding:      '3px 10px',
  fontSize:     12,
  border:       '1px solid #30363d',
  borderRadius: 6,
  cursor:       'pointer',
  transition:   'background 0.15s',
  whiteSpace:   'nowrap',
}

const exitBtnStyle = {
  ...baseBtnStyle,
  background: '#21262d',
  color:      '#f85149',
  borderColor: '#f85149',
}

const iconBtnStyle = (active, disabled = false) => ({
  ...baseBtnStyle,
  background:  active  ? '#1f6feb' : '#21262d',
  color:       disabled ? '#484f58' : active ? '#fff' : '#c9d1d9',
  borderColor: active  ? '#1f6feb' : '#30363d',
  cursor:      disabled ? 'not-allowed' : 'pointer',
  opacity:     disabled ? 0.6 : 1,
})

const speedBtnStyle = (active) => ({
  ...baseBtnStyle,
  padding:     '3px 8px',
  background:  active ? '#1f6feb' : '#21262d',
  color:       active ? '#fff' : '#c9d1d9',
  borderColor: active ? '#1f6feb' : '#30363d',
  fontWeight:  active ? 700 : 400,
})

const labelStyle = {
  color:    '#6e7681',
  fontSize: 12,
}

const dateLabelStyle = {
  color:      '#c9d1d9',
  fontSize:   13,
  fontFamily: 'monospace',
  marginLeft: 4,
}
