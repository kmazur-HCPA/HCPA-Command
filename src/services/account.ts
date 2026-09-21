import type { AppClient } from '../platform/supabase'
import { measured } from '../platform/telemetry'
import type { Database } from '../data/database.types'

export type Preferences = Database['public']['Tables']['user_preferences']['Row']
export type Theme = Preferences['theme']

export async function verifyAccess(client: AppClient) {
  return measured('access.check', async () => {
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return null
    if (user.is_anonymous) return null
    const { data, error: membershipError } = await client.from('app_memberships').select('user_id, active').eq('user_id', user.id).maybeSingle()
    if (membershipError) throw new Error('Access verification is unavailable. Please retry.')
    return data?.active ? user : null
  })
}

export async function readPreferences(client: AppClient, userId: string) {
  return measured('preferences.read', async () => {
    const { data, error } = await client.from('user_preferences').select('*').eq('user_id', userId).single()
    if (error) throw new Error('Your preferences could not be loaded. Please retry.')
    return data
  })
}

export async function saveTheme(client: AppClient, preferences: Preferences, theme: Theme) {
  return measured('preferences.write', async () => {
    const { data, error } = await client.from('user_preferences').update({ theme }).eq('user_id', preferences.user_id).eq('version', preferences.version).select('*').maybeSingle()
    if (error) throw new Error('The change was not saved. Please try again.')
    if (!data) throw new Error('Your preferences changed or access expired. Reload before trying again.')
    return data
  })
}
