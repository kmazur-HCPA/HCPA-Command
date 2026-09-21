import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AppClient } from '../../platform/supabase'
import { signIn, updatePassword } from '../../services/auth'

type Props = { client: AppClient; recovering?: boolean }

export function AuthForm({ client, recovering = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setError(''); setBusy(true)
    try {
      if (recovering) {
        await updatePassword(client, String(data.get('password') ?? ''), String(data.get('confirmation') ?? ''))
        form.reset()
      } else {
        await signIn(client, String(data.get('email') ?? ''), String(data.get('password') ?? ''))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }
  return <section className="auth-panel" aria-labelledby="auth-title">
    <p className="eyebrow">Your private workspace</p>
    <h1 id="auth-title">{recovering ? 'Choose a new password.' : 'Welcome to Command.'}</h1>
    <p className="intro">{recovering ? 'Use a unique password with at least 12 characters.' : 'A clear place to focus on what matters.'}</p>
    <form onSubmit={submit}>
      {!recovering && <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy} /></label>}
      {<label>Password<input name="password" type="password" autoComplete={recovering ? 'new-password' : 'current-password'} required minLength={recovering ? 12 : undefined} maxLength={256} disabled={busy} /></label>}
      {recovering && <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={busy} /></label>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : recovering ? 'Save password' : 'Sign in'}</button>
    </form>
    {!recovering && <p className="muted">For help with your password, contact the application administrator.</p>}
  </section>
}
