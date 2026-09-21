import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const assets = (await readdir('dist/assets')).filter(name => /\.(js|css|woff2)$/.test(name)).map(name => `/assets/${name}`)
const files = [...assets, '/icon.svg', '/favicon.ico', '/offline.html', '/offline.css', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest']
const hash = createHash('sha256')
for (const file of files) hash.update(await readFile(`dist${file}`))
const version = hash.digest('hex').slice(0,16)
await writeFile('dist/sw.js', `/* Static resources only. No HTML app, API, auth, or user-data cache. */
const CACHE = 'command-static-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('activate', event => { event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('command-static-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()); });
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting()); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if (request.mode === 'navigate') {
    // Never persist navigation responses or token-bearing recovery URLs.
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/offline.html'))));
  } else if (!url.search && FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});
`)
console.log(`PWA generated: ${files.length} static assets; no authenticated response caching.`)
