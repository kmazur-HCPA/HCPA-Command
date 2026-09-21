import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/data/database.types'

export type AccessDecision = 'allowed' | 'unauthenticated' | 'forbidden' | 'unavailable'
export type AccessVerifier = (token: string) => Promise<AccessDecision>

export function createVerifier(url: string, key: string): AccessVerifier {
  return async token => {
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]) }),
      },
    })
    const { data: { user }, error } = await client.auth.getUser(token)
    if (error) return error.status && error.status < 500 ? 'unauthenticated' : 'unavailable'
    if (!user || user.is_anonymous) return 'unauthenticated'
    const { data, error: membershipError } = await client.from('app_memberships').select('user_id, active').eq('user_id', user.id).maybeSingle()
    if (membershipError) return 'unavailable'
    return data?.active ? 'allowed' : 'forbidden'
  }
}

export async function handleAccess(request: Request, verify: AccessVerifier, requestId: string) {
  const started = performance.now()
  function respond(status: number, code: string) {
    console.info(JSON.stringify({ event: 'request_complete', operation: 'access.check', requestId, status, durationMs: Math.round(performance.now() - started) }))
    return Response.json({ code, requestId }, { status, headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId,
      ...(status === 405 ? { Allow: 'GET' } : {}),
    } })
  }
  if (request.method !== 'GET') return respond(405, 'method_not_allowed')
  const header = request.headers.get('authorization') ?? ''
  if (header.length > 8192 || !/^Bearer [^\s]+$/i.test(header)) return respond(401, 'authentication_required')
  try {
    const decision = await verify(header.slice(7))
    if (decision === 'unauthenticated') return respond(401, 'authentication_required')
    if (decision === 'forbidden') return respond(403, 'access_denied')
    if (decision === 'unavailable') return respond(503, 'temporarily_unavailable')
    return respond(200, 'access_confirmed')
  } catch { return respond(503, 'temporarily_unavailable') }
}
