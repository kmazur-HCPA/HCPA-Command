import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
const files = (await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name))
let gzipBytes = 0
for (const name of files) {
  const contents = await readFile(`dist/assets/${name}`)
  gzipBytes += gzipSync(contents).byteLength
  if (/sb_secret_[A-Za-z0-9_-]+|"role"\s*:\s*"service_role"|SUPABASE_SERVICE_ROLE_KEY/.test(contents.toString())) throw new Error(`Privileged key marker found in ${name}`)
  if (/MICROSOFT_CLIENT_SECRET|MICROSOFT_TOKEN_ENCRYPTION_KEY|ConfidentialClientApplication/.test(contents.toString())) throw new Error(`Server-only Microsoft code found in ${name}`)
  for (const candidate of contents.toString().matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(candidate[1], 'base64url').toString()).role === 'service_role') throw new Error('Privileged JWT detected') }
    catch (error) { if (error.message === 'Privileged JWT detected') throw error }
  }
}
if (gzipBytes > 190 * 1024) throw new Error(`Initial assets exceed 190 KiB gzip: ${gzipBytes}`)
const headers = await readFile('dist/_headers', 'utf8')
if (!headers.includes("frame-ancestors 'none'") || headers.includes("'unsafe-inline'") || headers.includes("'unsafe-eval'")) throw new Error('Security headers are missing or unsafe')
console.log(`Build verified: ${Math.round(gzipBytes / 1024)} KiB gzip JS/CSS, restrictive headers, no privileged key markers.`)
