import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile } from 'node:fs/promises'
import { readConfig } from './src/platform/config.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const context = process.env.CONTEXT
  const isolatedPreview = Boolean(context && !['production', 'dev'].includes(context))
  const clientEnv = isolatedPreview ? {} : env
  const config = readConfig(clientEnv)
  if (context === 'production' && !config) throw new Error('Production requires Supabase configuration.')
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_APP_ORIGIN'])
  if (Object.keys(env).some(key => !allowed.has(key))) throw new Error('Unexpected public environment variable; review before exposing it.')
  return {
    plugins: [react(), {
      name: 'command-security-headers',
      async closeBundle() {
        const connect = config ? ` ${config.supabaseUrl}` : ''
        await writeFile('dist/_headers', `/*\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'${connect}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Strict-Transport-Security: max-age=31536000\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`)
      },
    }],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(config?.supabaseUrl ?? ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(config?.publishableKey ?? ''),
      'import.meta.env.VITE_APP_ORIGIN': JSON.stringify(config?.appOrigin ?? ''),
    },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 450 },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  }
})
