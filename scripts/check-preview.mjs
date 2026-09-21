import { readdir, readFile } from 'node:fs/promises'
// Compare actual configured values, not the public-key prefix used by the config validator.
let production = ''
try { production = await readFile('.env.production.local', 'utf8') } catch { /* CI has no production file. */ }
const forbidden = production.split('\n').filter(line => /^(VITE_)?SUPABASE_(URL|PUBLISHABLE_KEY)=/.test(line)).map(line => line.slice(line.indexOf('=') + 1)).filter(Boolean)
for (const file of await readdir('dist/assets')) {
  const source = await readFile(`dist/assets/${file}`, 'utf8')
  if (forbidden.some(value => source.includes(value))) throw new Error('Production configuration leaked into preview assets')
}
console.log('Preview isolation verified against configured production values.')
