import { useState } from 'react'
import { createInvite } from '../api.js'

export default function InviteButton() {
  const [token, setToken] = useState(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const data = await createInvite()
      setToken(data.token)
      setCopied(false)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setOpen(false)
    setToken(null)
    setCopied(false)
  }

  if (!open) {
    return (
      <button style={inviteBtnStyle} onClick={() => { setOpen(true); handleGenerate() }}>
        + Invite
      </button>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={panelRowStyle}>
        <span style={labelStyle}>Invite token</span>
        <button style={closeBtnStyle} onClick={handleClose}>✕</button>
      </div>
      {loading ? (
        <span style={dimStyle}>Generating…</span>
      ) : (
        <div style={tokenRowStyle}>
          <code style={tokenStyle}>{token}</code>
          <button style={copyBtnStyle(copied)} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      <button style={newBtnStyle} onClick={handleGenerate} disabled={loading}>
        Generate another
      </button>
    </div>
  )
}

const inviteBtnStyle = {
  padding: '4px 12px',
  background: 'none',
  border: '1px solid #388bfd',
  borderRadius: 6,
  color: '#58a6ff',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const panelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '12px 14px',
  minWidth: 320,
}

const panelRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const labelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  color: '#8b949e',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
}

const tokenRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const tokenStyle = {
  flex: 1,
  fontSize: 13,
  color: '#e6edf3',
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '4px 8px',
  wordBreak: 'break-all',
}

const copyBtnStyle = (copied) => ({
  padding: '4px 10px',
  background: copied ? '#238636' : '#21262d',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: copied ? '#fff' : '#c9d1d9',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

const dimStyle = {
  fontSize: 13,
  color: '#8b949e',
}

const newBtnStyle = {
  alignSelf: 'flex-start',
  background: 'none',
  border: 'none',
  color: '#58a6ff',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
}
