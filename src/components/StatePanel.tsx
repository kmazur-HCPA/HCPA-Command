import type { ReactNode } from 'react'
export function StatePanel({ title, children, loading = false }: { title: string; children: ReactNode; loading?: boolean }) {
  return <section className="state-panel" aria-busy={loading}><h2>{title}</h2><div className="muted">{children}</div></section>
}
