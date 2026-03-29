import { useEffect, useState } from 'react'

export default function Toast({ message, onDismiss }) {
  const [hiding, setHiding] = useState(false)

  useEffect(() => {
    if (!message) return
    setHiding(false)
    const hide = setTimeout(() => setHiding(true), 4000)
    const remove = setTimeout(onDismiss, 4400)
    return () => { clearTimeout(hide); clearTimeout(remove) }
  }, [message])

  if (!message) return null

  return (
    <div style={{ ...toastStyle, opacity: hiding ? 0 : 1 }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
      {message}
    </div>
  )
}

const toastStyle = {
  position: 'fixed',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#3d1a1a',
  color: '#f85149',
  border: '1px solid #f85149',
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 9999,
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  transition: 'opacity 0.4s ease',
  whiteSpace: 'nowrap',
}
