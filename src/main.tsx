import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { readConfig } from './platform/config'
import { createAppClient } from './platform/supabase'
import './styles.css'
import { ConnectionStatus, UpdateNotice } from './pwa/Status'

const root = createRoot(document.getElementById('root')!)
try {
  const config = readConfig(import.meta.env)
  if (config) {
    root.render(<StrictMode><ConnectionStatus /><App client={createAppClient(config)} /><UpdateNotice /></StrictMode>)
  } else {
    root.render(<main className="entry-layout"><div className="entry-brand"><span className="brand"><span aria-hidden="true">/</span> COMMAND</span><p>Attention. Context. Action.</p></div><section className="auth-panel"><p className="eyebrow">Preview</p><h1>Command is taking shape.</h1><p className="intro">This preview is disconnected from your private workspace. Use the production application to sign in.</p></section></main>)
  }
} catch {
  root.render(<main className="entry-layout"><section className="auth-panel"><h1>Command is unavailable.</h1><p role="alert">Application configuration needs attention. Contact the administrator.</p></section></main>)
}
