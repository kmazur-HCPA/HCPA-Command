import type { Config, Context } from '@netlify/functions'
import { createVerifier, handleAccess } from './_shared/access'

export default async (request: Request, context: Context) => {
  const requestId = context.requestId || crypto.randomUUID()
  const url = Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY')
  // Preview functions remain disconnected, even if production variables are accidentally inherited.
  const deployContext = Netlify.env.get('CONTEXT')
  if ((deployContext && !['production', 'dev'].includes(deployContext)) || !url || !key || !key.startsWith('sb_publishable_')) {
    return Response.json({ code: 'not_configured', requestId }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
  return handleAccess(request, createVerifier(url, key), requestId)
}
export const config: Config = { path: '/api/access' }
