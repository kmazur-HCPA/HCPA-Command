export type AppConfig = {
  supabaseUrl: string
  publishableKey: string
  appOrigin: string
}

export function readConfig(env: Record<string, unknown>): AppConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim()
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const origin = String(env.VITE_APP_ORIGIN ?? '').trim()
  if (!url && !key) return null
  if (!url || !key || !origin) throw new Error('Incomplete application configuration.')
  const service = new URL(url)
  const app = new URL(origin)
  for (const candidate of [service, app]) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname)
    if ((!local && candidate.protocol !== 'https:') || (local && !['http:', 'https:'].includes(candidate.protocol)) || candidate.username || candidate.password || candidate.search || candidate.hash || candidate.pathname !== '/') {
      throw new Error('Application URLs must be secure origins.')
    }
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) {
    throw new Error('Only a Supabase publishable key is allowed in the application.')
  }
  return { supabaseUrl: service.origin, publishableKey: key, appOrigin: app.origin }
}
