import { readFile, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
test('installs static cache, excludes private responses, and opens neutral offline page', async ({ page, context, request }) => {
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((icon: {sizes:string}) => icon.sizes)).toEqual(['192x192','512x512'])
  // Same-origin requests outside the exact static allowlist must never enter caches.
  await page.evaluate(async () => { await fetch('/api/access', {headers:{Authorization:'Bearer synthetic-test-token'}}); await fetch('/auth/reset?code=synthetic-recovery-code') })
  const urls = await page.evaluate(async () => {
    const result:string[]=[]
    for(const name of await caches.keys()) for(const req of await (await caches.open(name)).keys()) result.push(new URL(req.url).pathname)
    return result
  })
  expect(urls).toContain('/offline.html')
  expect(urls.some(url=>url==='/' || url.includes('/api/') || url.includes('/auth/'))).toBe(false)
  await context.setOffline(true)
  await page.goto('/')
  await expect(page.getByRole('heading', {name:'You’re offline.'})).toBeVisible()
  await expect(page.getByLabel('Password', {exact:true})).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole('link',{name:'Try again'}).click()
  await expect(page.getByRole('heading',{name:'Welcome to Command.'})).toBeVisible()
})

test('a waiting update requires an explicit reload action', async ({page}) => {
  const original = await readFile('dist/sw.js','utf8')
  try {
    await page.goto('/')
    await page.evaluate(async()=>{await navigator.serviceWorker.ready})
    await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
    await writeFile('dist/sw.js',original+'\n// synthetic update lifecycle test\n')
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration?.update()})
    await expect(page.getByRole('button',{name:'Update and reload'})).toBeVisible()
    expect(await page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)
    await page.getByRole('button',{name:'Update and reload'}).click()
    await expect(page.getByRole('button',{name:'Update and reload'})).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Welcome to Command.'})).toBeVisible()
  } finally { await writeFile('dist/sw.js',original) }
})
