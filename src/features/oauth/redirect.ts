// Only Claude's own OAuth callbacks may receive a Command authorization code:
// claude.ai / Claude Desktop use the hosted callback, Claude Code a loopback port.
export function trustedRedirect(value: string) {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.username || url.password || url.hash) return false
  if (url.protocol === 'https:') return ['claude.ai', 'claude.com'].includes(url.hostname) && url.pathname === '/api/mcp/auth_callback' && !url.port
  // RFC 8252 loopback redirects never leave this computer.
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
}
