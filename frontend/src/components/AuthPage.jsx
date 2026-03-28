import { useState } from 'react'
import { login, register } from '../api.js'

export default function AuthPage({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (m) => { setMode(m); setError(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      let data
      if (mode === 'login') {
        data = await login(username, password)
      } else {
        data = await register(username, password, inviteToken)
      }
      localStorage.setItem('cv_token', data.access_token)
      onLogin(data.access_token)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>ChartViewer</h1>

        <div style={tabsStyle}>
          <button style={tabStyle(mode === 'login')} onClick={() => switchMode('login')}>
            Sign In
          </button>
          <button style={tabStyle(mode === 'register')} onClick={() => switchMode('register')}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          <input
            style={inputStyle}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
          <input
            style={inputStyle}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
          {mode === 'register' && (
            <input
              style={inputStyle}
              type="text"
              placeholder="Invite code"
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              required
            />
          )}
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" style={submitStyle} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}

const pageStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  background: '#0d1117',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const cardStyle = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '32px 40px',
  width: 320,
}

const titleStyle = {
  margin: '0 0 24px',
  fontSize: 22,
  fontWeight: 700,
  color: '#e6edf3',
  textAlign: 'center',
}

const tabsStyle = {
  display: 'flex',
  marginBottom: 20,
  borderBottom: '1px solid #30363d',
}

const tabStyle = (active) => ({
  flex: 1,
  padding: '8px 0',
  background: 'none',
  border: 'none',
  borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
  color: active ? '#58a6ff' : '#8b949e',
  fontSize: 14,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  marginBottom: -1,
})

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const inputStyle = {
  padding: '8px 12px',
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#e6edf3',
  fontSize: 14,
  outline: 'none',
}

const errorStyle = {
  margin: 0,
  fontSize: 13,
  color: '#f85149',
}

const submitStyle = {
  padding: '9px 0',
  background: '#238636',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 4,
}
