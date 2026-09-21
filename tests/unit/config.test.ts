import { describe, expect, it } from 'vitest'
import { readConfig } from '../../src/platform/config'
const valid = { VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key', VITE_APP_ORIGIN: 'https://cmd.hillspafl.gov' }
describe('public configuration', () => {
  it('supports disconnected previews', () => { expect(readConfig({})).toBeNull() })
  it('requires complete settings', () => { expect(() => readConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL })).toThrow() })
  it('accepts secure origins and a publishable key', () => { expect(readConfig(valid)?.appOrigin).toBe(valid.VITE_APP_ORIGIN) })
  it.each(['sb_secret_private', 'eyJlegacyprivileged', 'service_role'])('rejects a non-publishable credential %s', key => { expect(() => readConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow() })
  it.each(['http://example.com', 'https://name:password@example.com', 'https://example.com/path', 'https://example.com?token=value'])('rejects unsafe origin %s', url => { expect(() => readConfig({ ...valid, VITE_APP_ORIGIN: url })).toThrow() })
})
