import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppClient } from '../platform/supabase'
import { readPreferences, saveTheme } from '../services/account'
import type { Preferences, Theme } from '../services/account'
import { signOut } from '../services/auth'
import { Detail } from '../features/work/Detail'
import type { Kind,WorkItem } from '../features/work/model'
import { labels } from '../features/work/model'
import { WorkList } from '../features/work/WorkList'
import { WorkDay } from '../features/work/WorkDay'
import { Capture } from '../features/work/Capture'
import { Drafts } from '../features/work/Drafts'
import { Lab } from '../features/lab/Lab'
import { listDrafts } from '../platform/drafts'

export function Workspace({ client, user }: { client: AppClient; user: User }) {
  const [page, setPage] = useState<'workspace' | 'settings' | 'lab' | Kind>('workspace')
  const [capture,setCapture]=useState(false)
  const [workRevision,setWorkRevision]=useState(0)
  const [recordId,setRecordId]=useState<string|null>(()=>new URLSearchParams(location.search).get('record'))
  function openRecord(item:Pick<WorkItem,'id'>){setRecordId(item.id);history.replaceState(null,'',`/?record=${item.id}`)}
  function closeRecord(){setRecordId(null);history.replaceState(null,'','/')}
  function navigate(next: 'workspace' | 'settings' | 'lab' | Kind) { closeRecord(); setPage(next); requestAnimationFrame(() => document.querySelector<HTMLElement>('#main h1')?.focus()) }
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
    try {
      const drafts=listDrafts(localStorage,user.id)
      if(drafts.length){setError('You have unsaved local drafts. Save them, or export and explicitly discard them in Settings before signing out.');closeRecord();setPage('settings');return}
    } catch {setError('Draft storage could not be checked. Resolve local draft recovery before signing out.');return}
    setBusy(true); setError('')
    try { await signOut(client) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to sign out.'); setBusy(false) }
  }
  useEffect(()=>{
    const guard=(event:Event)=>{try{if(listDrafts(localStorage,user.id).length)event.preventDefault()}catch{event.preventDefault()}}
    window.addEventListener('command:before-update',guard)
    return()=>window.removeEventListener('command:before-update',guard)
  },[user.id])
  return <div className="workspace app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="workspace-header"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><span className="header-context">Your private workspace</span><button className="capture-button" onClick={()=>setCapture(true)}>Quick Capture</button><button type="button" disabled={busy} onClick={() => void logout()}>Sign out</button></header>
    <nav className="shell-nav" aria-label="Main navigation">
      <button aria-current={page==='workspace'?'page':undefined} onClick={()=>navigate('workspace')}>Work Day</button>
      {(['task','project','journal','person','initiative','learning','library'] as Kind[]).map(kind=><button key={kind} aria-current={page===kind?'page':undefined} onClick={()=>navigate(kind)}>{labels[kind]}</button>)}
      <button aria-current={page==='lab'?'page':undefined} onClick={()=>navigate('lab')}>AI Lab</button>
      <button aria-current={page==='settings'?'page':undefined} onClick={()=>navigate('settings')}>Settings</button>
      <span className="nav-caption">ATTENTION. CONTEXT. ACTION.</span>
    </nav>
    <main id="main" className="workspace-content" tabIndex={-1}>
      {recordId ? <Detail key={recordId} client={client} userId={user.id} id={recordId} onClose={closeRecord}/> : page==='lab'?<Lab client={client} userId={user.id} onOpen={openRecord}/> : (page!=='workspace'&&page!=='settings') ? <WorkList key={page} client={client} userId={user.id} kind={page} onOpen={openRecord}/> : <>
      {page==='workspace'?<WorkDay client={client} revision={workRevision} onOpen={openRecord} onNavigate={navigate}/>:<>
        <p className="eyebrow">Make it yours</p><h1 tabIndex={-1}>Settings</h1>
        <section className="settings-panel" aria-labelledby="appearance-title"><h2 id="appearance-title">Appearance</h2><p className="muted">Choose a theme for your signed-in devices.</p>
          <label>Appearance<select aria-label="Appearance" value={preferences?.theme??'dark'} disabled={!preferences||busy} onChange={event=>void changeTheme(event.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label>
          <p className="muted small">Time zone · America/New_York</p><p className="notice" role="status">{message}</p>
        </section>
        <Drafts userId={user.id}/>
        <section className="settings-panel"><h2>Install Command</h2><p className="muted">In Safari on iPad or iPhone, use Share → Add to Home Screen. On desktop, use your browser’s install option.</p></section>
      </>}
      </>}
      {error && <div role="alert" className="error-message"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setMessage(''); setReload(value => value + 1) }}>Reload preferences</button></div>}
    </main>
    {capture&&<Capture client={client} userId={user.id} onClose={()=>setCapture(false)} onSaved={()=>{setCapture(false);setWorkRevision(v=>v+1);navigate('journal')}}/>}
  </div>
}
