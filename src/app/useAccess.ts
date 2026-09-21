import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppClient } from '../platform/supabase'
import { verifyAccess } from '../services/account'

export type AccessState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'denied' }
  | { kind: 'ready' | 'recovery'; user: User }
  | { kind: 'error'; message: string }

export function useAccess(client: AppClient, attempt: number) {
  const [state, setState] = useState<AccessState>({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    let generation = 0
    let recovering = window.location.pathname === '/auth/reset'
    async function check() {
      const ticket = ++generation
      setState({ kind: 'loading' })
      try {
        const { data: { session }, error } = await client.auth.getSession()
        if (error) throw new Error('Your sign-in link or session is unavailable. Please sign in again.')
        if (alive && ticket === generation && (window.location.search || window.location.hash)) {
          const url=new URL(window.location.href)
          for(const name of ['code','error','error_code','error_description','token_hash','type'])url.searchParams.delete(name)
          url.hash=''
          window.history.replaceState(null, '', url.pathname+url.search)
        }
        if (!session) {
          if (alive && ticket === generation) setState({ kind: 'signed-out' })
          return
        }
        const user = await verifyAccess(client)
        if (alive && ticket === generation) setState(user ? { kind: recovering ? 'recovery' : 'ready', user } : { kind: 'denied' })
      } catch (error) {
        if (alive && ticket === generation) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to verify access. Please retry.' })
      }
    }
    // Do not await auth methods inside the auth event callback: Supabase holds its auth lock there.
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') recovering = true
      if (event === 'SIGNED_OUT') {
        generation++
        recovering = false
        window.history.replaceState(null, '', '/')
        if (alive) setState({ kind: 'signed-out' })
      } else if (event !== 'INITIAL_SESSION') {
        queueMicrotask(() => { if (alive) void check() })
      }
    })
    void check()
    const onFocus = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', onFocus)
    return () => { alive = false; generation++; subscription.unsubscribe(); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('online', onFocus) }
  }, [client, attempt])
  return state
}
