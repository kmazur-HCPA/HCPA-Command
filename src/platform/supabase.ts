import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from './config'
import type { Database } from '../data/database.types'

export function createAppClient(config: AppConfig) {
  return createClient<Database>(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { 'X-Client-Info': 'command-web/0.1' } },
  })
}
export type AppClient = ReturnType<typeof createAppClient>
