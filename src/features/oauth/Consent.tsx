import { useEffect, useState } from 'react'
import type { AppClient } from '../../platform/supabase'
import { trustedRedirect } from './redirect'

type Details = { client_name: string; redirect_host: string; email: string }
type Decision = 'details' | 'approve' | 'deny'

// Command is the authorization server: the request parameters arrive from the
// Claude connector on the URL and are checked again by /api/oauth/authorize.
async function decide(client: AppClient, query: string, decision: Decision) {
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) throw new Error('Sign in to Command first.')
  const params = Object.fromEntries(new URLSearchParams(query))
  const response = await fetch('/api/oauth/authorize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, decision }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? 'Command could not process this request.')
  return body
}

export function Consent({ client, query }: { client: AppClient; query: string }) {
  const [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    decide(client, query, 'details').then(value => { if (active) setDetails(value) })
      .catch(e => { if (active) setError((e as Error).message + ' Start again from Claude.') })
    return () => { active = false }
  }, [client, query])
  async function choose(approve: boolean) {
    if (!details || busy) return
    setBusy(true); setError('')
    try {
      const { redirect_url } = await decide(client, query, approve ? 'approve' : 'deny')
      if (trustedRedirect(redirect_url)) window.location.assign(redirect_url)
      else throw new Error('The return address is not Claude, so nothing was sent.')
    } catch (e) { setBusy(false); setError((e as Error).message) }
  }
  return <main id="main" className="entry-layout"><div className="entry-brand"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><p>Attention. Context. Action.</p></div>
    <section className="auth-panel" aria-labelledby="consent-title" aria-busy={!details && !error}>
      <p className="eyebrow">Connect an app</p>
      <h1 id="consent-title">{details ? `Allow ${details.client_name || 'this app'} to use Cora?` : 'Checking this request…'}</h1>
      {details && <>
        <p className="intro">It will act as you ({details.email}) through Command's Cora tools.</p>
        <ul>
          <li>Read all of your Command records, and your Outlook calendar, mail and Teams through Command's read-only Microsoft connection.</li>
          <li>Save new reminders, tasks, people, projects, initiatives, journal entries and AI Lab records when you ask, and save Command Brief receipts.</li>
          <li>Prepare edits for you to confirm in Command. It cannot send email or Teams messages or change meetings.</li>
        </ul>
        <p className="muted small">Returns to: {details.redirect_host}. The connection stays active while it is used, and you can revoke it at any time in Settings → Cora in connected apps.</p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void choose(true)}>{busy ? 'Please wait…' : 'Allow'}</button>
          <button disabled={busy} onClick={() => void choose(false)}>Deny</button>
        </div>
      </>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {!details && !error && <p className="muted" role="status">Loading connection details.</p>}
    </section>
  </main>
}
