import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppClient } from '../platform/supabase'
import { readPreferences, saveTheme } from '../services/account'
import type { Preferences, Theme } from '../services/account'
import { signOut } from '../services/auth'

export function Workspace({ client, user }: { client: AppClient; user: User }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    readPreferences(client, user.id).then(value => { if (alive) { setPreferences(value); setError('') } }).catch(caught => { if (alive) setError(caught instanceof Error ? caught.message : 'Unable to load preferences.') })
    return () => { alive = false }
  }, [client, user.id, reload])
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = preferences?.theme === 'system' ? (query.matches ? 'dark' : 'light') : (preferences?.theme ?? 'dark') }
    apply(); query.addEventListener('change', apply)
    return () => { query.removeEventListener('change', apply); delete document.documentElement.dataset.theme }
  }, [preferences?.theme])
  async function changeTheme(theme: Theme) {
    if (!preferences || busy) return
    setBusy(true); setError(''); setMessage('')
    try { setPreferences(await saveTheme(client, preferences, theme)); setMessage('Appearance saved.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save appearance.') }
    finally { setBusy(false) }
  }
  async function logout() {
    setBusy(true); setError('')
    try { await signOut(client) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to sign out.'); setBusy(false) }
  }
  return <div className="workspace">
    <header className="workspace-header"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><button type="button" disabled={busy} onClick={() => void logout()}>Sign out</button></header>
    <main id="main" className="workspace-content">
      <p className="eyebrow">The foundation is in place</p><h1>Your workspace is ready.</h1>
      <p className="intro">You’re signed in to Command. Work Day, Tasks and Reminders will arrive in the next development phases.</p>
      <section className="settings-panel" aria-labelledby="appearance-title"><h2 id="appearance-title">Make yourself comfortable.</h2><p className="muted">Choose how Command looks on this device and your other signed-in devices.</p>
        <label>Appearance<select aria-label="Appearance" value={preferences?.theme ?? 'dark'} disabled={!preferences || busy} onChange={event => void changeTheme(event.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label>
        <p className="muted small">Time zone · {preferences?.timezone ?? 'America/New_York'}</p>
        {error && <div role="alert" className="error-message"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setMessage(''); setReload(value => value + 1) }}>Reload preferences</button></div>}
        <p className="notice" role="status">{message}</p>
      </section>
    </main>
  </div>
}
