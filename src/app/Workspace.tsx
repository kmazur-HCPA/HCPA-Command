import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppClient } from '../platform/supabase'
import { readPreferences, saveTheme } from '../services/account'
import type { Preferences, Theme } from '../services/account'
import { signOut } from '../services/auth'
import { StatePanel } from '../components/StatePanel'

export function Workspace({ client, user }: { client: AppClient; user: User }) {
  const [page, setPage] = useState<'workspace' | 'settings'>('workspace')
  const heading = useRef<HTMLHeadingElement>(null)
  function navigate(next: 'workspace' | 'settings') { setPage(next); requestAnimationFrame(() => heading.current?.focus()) }
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
  return <div className="workspace app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="workspace-header"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><span className="header-context">Your private workspace</span><button type="button" disabled={busy} onClick={() => void logout()}>Sign out</button></header>
    <nav className="shell-nav" aria-label="Main navigation">
      <button aria-current={page === 'workspace' ? 'page' : undefined} onClick={() => navigate('workspace')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10 12 3l9 7v11h-6v-7H9v7H3Z" /></svg>Workspace</button>
      <button aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6" /></svg>Settings</button>
      <span className="nav-caption">ATTENTION. CONTEXT. ACTION.</span>
    </nav>
    <main id="main" className="workspace-content" tabIndex={-1}>
      <p className="eyebrow">{page === 'workspace' ? 'A place to begin' : 'Make it yours'}</p>
      <h1 ref={heading} tabIndex={-1}>{page === 'workspace' ? 'Your workspace is ready.' : 'Settings'}</h1>
      {page === 'workspace' ? <>
        <p className="intro">A little less noise. A clearer next step.</p>
        <div className="overview-grid">
          <section className="welcome-card"><span className="card-index" aria-hidden="true">01 / GET SETTLED</span><h2>Make room for your day.</h2><p className="muted">Command’s foundation is ready. Work Day, Tasks and Reminders will arrive in the next development phases.</p><button onClick={() => navigate('settings')}>Personalize Command <span aria-hidden="true">↗</span></button></section>
          <StatePanel title="Keep Command close."><p>On iPad or iPhone, open Command in Safari, use Share, then Add to Home Screen. Enable Open as Web App if offered.</p><p>On desktop, use your browser’s install option when available.</p><p className="small">An internet connection is required to open and save your private workspace.</p></StatePanel>
        </div>
        <p className="workspace-footer">Designed for a focused day. Built one useful step at a time.</p>
      </> : <>
        <p className="intro">A comfortable workspace, wherever you open it.</p>
        {!preferences && !error && <StatePanel title="Loading your preferences…" loading><p>Your saved appearance will be ready shortly.</p></StatePanel>}
        <section className="settings-panel" aria-labelledby="appearance-title"><h2 id="appearance-title">Appearance</h2><p className="muted">Choose a theme for your signed-in devices.</p>
          <label>Appearance<select aria-label="Appearance" value={preferences?.theme ?? 'dark'} disabled={!preferences || busy} onChange={event => void changeTheme(event.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label>
          <p className="muted small">Time zone · {preferences?.timezone ?? 'America/New_York'}</p>
          <p className="notice" role="status">{message}</p>
        </section>
      </>}
      {error && <div role="alert" className="error-message"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setMessage(''); setReload(value => value + 1) }}>Reload preferences</button></div>}
    </main>
  </div>
}
