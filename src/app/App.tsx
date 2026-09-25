import { lazy, Suspense, useState } from 'react'
import type { AppClient } from '../platform/supabase'
import { AuthForm } from '../features/auth/AuthForm'
import { useAccess } from './useAccess'
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })))
const Consent = lazy(() => import('../features/oauth/Consent').then(module => ({ default: module.Consent })))
import { signOut } from '../services/auth'

export function App({ client }: { client: AppClient }) {
  const [attempt, setAttempt] = useState(0)
  const [logoutError, setLogoutError] = useState('')
  const access = useAccess(client, attempt)
  async function logout() {
    setLogoutError('')
    try { await signOut(client) }
    catch { setLogoutError('Sign-out failed. Please check your connection and retry.') }
  }
  // Claude's connector sign-in lands here after Command's normal sign-in and access check.
  const authorization = location.pathname === '/oauth/consent' ? new URLSearchParams(location.search).get('authorization_id') : null
  if (access.kind === 'ready' && authorization) return <Suspense fallback={<main className="entry-layout" aria-busy="true"><p role="status">Checking this request…</p></main>}><Consent client={client} authorizationId={authorization} /></Suspense>
  if (access.kind === 'ready') return <Suspense fallback={<main className="workspace-content" aria-busy="true"><p role="status">Opening your workspace…</p></main>}><Workspace key={access.user.id} client={client} user={access.user} /></Suspense>
  return <main id="main" className="entry-layout"><div className="entry-brand"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><p>Attention. Context. Action.</p></div>
    {access.kind === 'signed-out' && <AuthForm client={client} />}
    {access.kind === 'recovery' && <AuthForm client={client} recovering />}
    {access.kind === 'loading' && <section className="auth-panel" aria-busy="true"><p className="eyebrow">Command</p><h1>Opening your workspace…</h1><p className="muted" role="status">Checking your access.</p></section>}
    {(access.kind === 'denied' || access.kind === 'error') && <section className="auth-panel"><p className="eyebrow">Private access</p><h1>{access.kind === 'denied' ? 'Access is not enabled.' : 'Unable to open Command.'}</h1><p className="intro">{access.kind === 'denied' ? 'This account is not authorized for Command. Contact the application administrator.' : access.message}</p><div className="actions"><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button><button type="button" onClick={() => void logout()}>Sign out</button></div>{logoutError && <p role="alert" className="error-message">{logoutError}</p>}</section>}
  </main>
}
