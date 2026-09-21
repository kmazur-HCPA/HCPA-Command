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

export function UpdateNotice() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let alive = true
    let registration: ServiceWorkerRegistration | undefined
    const inspect = () => { if (alive && registration?.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting) }
    const found = () => { registration?.installing?.addEventListener('statechange', inspect) }
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(value => {
      registration = value; inspect(); value.addEventListener('updatefound', found)
      if (alive) void value.update().catch(() => undefined)
    }).catch(() => { if (alive) setError('Offline installation is unavailable. Command still works online.') })
    return () => { alive = false; registration?.removeEventListener('updatefound', found) }
  }, [])
  function update() {
    if(!window.dispatchEvent(new Event('command:before-update',{cancelable:true}))){setError('Save, export or discard your local drafts before updating.');return}
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting?.postMessage({ type: 'ACTIVATE_UPDATE' })
  }
  if (error) return <aside className="update-notice" role="status"><p>{error}</p>{waiting&&<button onClick={()=>{setError('');update()}}>Retry update</button>}</aside>
  return waiting && <aside className="update-notice" aria-label="Application update"><p>A new version of Command is ready.</p><button onClick={update}>Update and reload</button></aside>
}
