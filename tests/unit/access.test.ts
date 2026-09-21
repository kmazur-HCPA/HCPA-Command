import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAccess } from '../../netlify/functions/_shared/access'

afterEach(() => { vi.restoreAllMocks() })
describe('server access boundary', () => {
  it.each(['', 'Basic credentials', 'Bearer a b', `Bearer ${'a'.repeat(8193)}`])('rejects invalid authorization without querying data', async authorization => {
    const verify = vi.fn()
    const result = await handleAccess(new Request('https://command.test/api/access', { headers: { authorization } }), verify, 'test-request')
    expect(result.status).toBe(401); expect(verify).not.toHaveBeenCalled()
  })
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503], ['allowed', 200]] as const)('maps %s to %s without exposing user data', async (decision, status) => {
    const response = await handleAccess(new Request('https://command.test/api/access', { headers: { authorization: 'Bearer test-token' } }), async () => decision, 'test-request')
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('test-token')
  })
  it('does not log credentials or provider errors', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const result = await handleAccess(new Request('https://command.test/api/access', { headers: { authorization: 'Bearer private-token' } }), async () => { throw new Error('internal-database-secret') }, 'request-123')
    expect(result.status).toBe(503); expect(JSON.stringify(logger.mock.calls)).not.toMatch(/private-token|internal-database-secret/)
  })
  it('rejects unexpected methods', async () => {
    const verify = vi.fn()
    const response = await handleAccess(new Request('https://command.test/api/access', { method: 'POST' }), verify, 'request-123')
    expect(response.status).toBe(405); expect(verify).not.toHaveBeenCalled()
  })
})
