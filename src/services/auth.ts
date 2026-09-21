import type { AppClient } from '../platform/supabase'
import { measured } from '../platform/telemetry'

export async function signIn(client: AppClient, email: string, password: string) {
  return measured('auth.sign_in', async () => {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error('Unable to sign in. Check your credentials and connection, then try again.')
  })
}
export async function signOut(client: AppClient) {
  return measured('auth.sign_out', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Sign-out could not be completed. Check your connection and try again.')
  })
}
export async function updatePassword(client: AppClient, password: string, confirmation: string) {
  if (password.length < 12) throw new Error('Use at least 12 characters for your password.')
  if (password !== confirmation) throw new Error('The passwords do not match.')
  return measured('auth.password_update', async () => {
    const { error } = await client.auth.updateUser({ password })
    if (error) throw new Error('Your password could not be changed. Request a fresh recovery link and try again.')
    const { error: signOutError } = await client.auth.signOut({ scope: 'global' })
    if (signOutError) throw new Error('Your password changed, but other sessions could not be signed out. Contact the application administrator.')
  })
}
