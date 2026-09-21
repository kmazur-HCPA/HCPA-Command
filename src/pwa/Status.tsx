import { useEffect, useState } from 'react'

export function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return online ? null : <div className="connection-banner" role="status">You’re offline. Reconnect to load or save your workspace.</div>
}

// Navigation always goes to the network. New app code is available on a normal
// refresh; the offline worker takes over naturally when older tabs are closed.
// Never reload an active editor or interrupt the user for a static-cache update.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(() => { /* Online operation remains available without offline installation. */ })
  }, [])
  return null
}
