import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
const userId = '11111111-1111-4111-8111-111111111111'
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', is_anonymous: false }
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.synthetic`
async function mockBackend(page: Page, options: { approved?: boolean; wrongPassword?: boolean; revoked?: boolean } = {}) {
  let preferences = { user_id: userId, theme: 'dark', timezone: 'America/New_York', version: 1, updated_at: '2026-09-21T12:00:00Z' }
  await page.route('https://command-test.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/v1/token') {
      if(options.wrongPassword) return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } })
      return route.fulfill({ json: { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'synthetic-refresh', user } })
    }
    if(url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
    if(url.pathname === '/rest/v1/app_memberships') return route.fulfill({ json: options.approved === false || options.revoked ? null : { user_id: userId, active: true } })
    if(url.pathname === '/rest/v1/user_preferences') {
      if(route.request().method() === 'PATCH') preferences = { ...preferences, ...route.request().postDataJSON(), version: preferences.version + 1 }
      return route.fulfill({ json: preferences })
    }
    if(url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/recover') return route.fulfill({ json: {} })
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request' } })
  })
}
async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-password-for-test')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
test('sign in, save preference, reload, and sign out', async ({ page }) => {
  await mockBackend(page); await login(page)
  await expect(page.getByRole('heading', { name: 'Your workspace is ready.' })).toBeVisible()
  await page.getByLabel('Appearance').selectOption('light')
  await expect(page.getByRole('status')).toHaveText('Appearance saved.')
  await page.reload()
  await expect(page.getByLabel('Appearance')).toHaveValue('light')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome to Command.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Welcome to Command.' })).toBeVisible()
})
test('authenticated but unapproved account never sees workspace', async ({ page }) => {
  await mockBackend(page, { approved: false }); await login(page)
  await expect(page.getByRole('heading', { name: 'Access is not enabled.' })).toBeVisible()
  await expect(page.getByLabel('Appearance')).toHaveCount(0)
})
test('invalid credentials receive a generic error', async ({ page }) => {
  await mockBackend(page, { wrongPassword: true }); await login(page)
  await expect(page.getByRole('alert')).toContainText('Unable to sign in.')
})
test('email recovery is deferred and administrator help is shown', async ({ page }) => {
  await mockBackend(page); await page.goto('/')
  await expect(page.getByText('For help with your password, contact the application administrator.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Forgot your password?' })).toHaveCount(0)
})
test('lost authorization on reload removes private UI', async ({ page }) => {
  const options = { approved: true, revoked: false }
  await mockBackend(page, options); await login(page)
  await expect(page.getByRole('heading', { name: 'Your workspace is ready.' })).toBeVisible()
  options.revoked = true; await page.reload()
  await expect(page.getByRole('heading', { name: 'Access is not enabled.' })).toBeVisible()
})
for(const width of [390,744,1133]) {
  test(`sign-in fits ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await mockBackend(page); await page.goto('/')
    await expect(page.getByLabel('Email')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
