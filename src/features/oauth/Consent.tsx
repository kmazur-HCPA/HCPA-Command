import { useEffect, useState } from 'react'
import type { AppClient } from '../../platform/supabase'
import { trustedRedirect } from './redirect'

type Details = { authorization_id: string; redirect_uri: string; client: { name: string; uri: string }; user: { email: string }; scope: string }

export function Consent({ client, authorizationId }: { client: AppClient; authorizationId: string }) {
  const [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void client.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!active) return
      if (error || !data) return setError('This connection request is invalid or has expired. Start again from Claude.')
      // Already approved earlier: Supabase returns the redirect directly.
      if (!('authorization_id' in data)) {
        if (trustedRedirect(data.redirect_url)) window.location.assign(data.redirect_url)
        else setError('This connection request is not from Claude and was not approved.')
        return
      }
      setDetails(data)
    })
    return () => { active = false }
  }, [client, authorizationId])
  async function decide(approve: boolean) {
    if (!details || busy) return
    setBusy(true); setError('')
    const call = approve ? client.auth.oauth.approveAuthorization : client.auth.oauth.denyAuthorization
    const { data, error } = await call.call(client.auth.oauth, details.authorization_id, { skipBrowserRedirect: true })
    if (error || !data) { setBusy(false); return setError('Command could not record your decision. Start again from Claude.') }
    if (trustedRedirect(data.redirect_url)) window.location.assign(data.redirect_url)
    else { setBusy(false); setError(approve ? 'Approved, but the return address is not Claude. Revoke this connection in Settings.' : 'Connection declined. You can close this tab.') }
  }
  const trusted = details ? trustedRedirect(details.redirect_uri) : false
  return <main id="main" className="entry-layout"><div className="entry-brand"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><p>Attention. Context. Action.</p></div>
    <section className="auth-panel" aria-labelledby="consent-title" aria-busy={!details && !error}>
      <p className="eyebrow">Connect an app</p>
      <h1 id="consent-title">{details ? `Allow ${details.client.name || 'this app'} to use Cora?` : 'Checking this request…'}</h1>
      {details && <>
        <p className="intro">It will act as you ({details.user.email}) through Command's Cora tools.</p>
        <ul>
          <li>Read all of your Command records, and your Outlook calendar, mail and Teams through Command's read-only Microsoft connection.</li>
          <li>Save new reminders, tasks, people, projects, initiatives, journal entries and AI Lab records when you ask, and save Command Brief receipts.</li>
          <li>Prepare edits for you to confirm in Command. It cannot send email or Teams messages or change meetings.</li>
        </ul>
        <p className="muted small">Returns to: {new URL(details.redirect_uri).host}. You can revoke access at any time in Settings → Cora in connected apps.</p>
        {!trusted && <p role="alert" className="error-message">This request does not return to Claude, so it cannot be approved.</p>}
        <div className="actions">
          <button className="primary" disabled={busy || !trusted} onClick={() => void decide(true)}>{busy ? 'Please wait…' : 'Allow'}</button>
          <button disabled={busy} onClick={() => void decide(false)}>Deny</button>
        </div>
      </>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {!details && !error && <p className="muted" role="status">Loading connection details.</p>}
    </section>
  </main>
}
