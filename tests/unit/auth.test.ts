import { describe, expect, it, vi } from 'vitest'
import type { AppClient } from '../../src/platform/supabase'
import { updatePassword } from '../../src/services/auth'
function mockClient() {
  const auth = { updateUser: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn().mockResolvedValue({ error: null }), resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) }
  return { auth, client: { auth } as unknown as AppClient }
}
describe('account recovery', () => {
  it('rejects mismatched and short passwords without sending them', async () => {
    const { auth, client } = mockClient()
    await expect(updatePassword(client,'short','short')).rejects.toThrow('12 characters')
    await expect(updatePassword(client,'long-password-example','different-password')).rejects.toThrow('do not match')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('changes the password and signs out all refresh sessions', async () => {
    const { auth, client } = mockClient()
    await updatePassword(client,'long-password-example','long-password-example')
    expect(auth.updateUser).toHaveBeenCalledWith({ password:'long-password-example' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope:'global' })
  })
  it('does not falsely report complete recovery if session revocation fails', async () => {
    const { auth, client } = mockClient(); auth.signOut.mockResolvedValue({ error: new Error('provider detail') })
    await expect(updatePassword(client,'long-password-example','long-password-example')).rejects.toThrow('other sessions could not be signed out')
  })
})
