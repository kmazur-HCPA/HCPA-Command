import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
let db: PGlite
type Row = Record<string, unknown>
const item = (kind: string, title: string, extra: Row = {}) => {
  const row: Row = { kind, title, status: kind === 'task' ? 'Inbox' : 'Active', user_id: owner, ...extra }
  const keys = Object.keys(row)
  return db.query<{ id: string }>(`insert into public.work_items(${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, keys.map(k => row[k] as never)).then(r => r.rows[0]!.id)
}
const one = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows[0]!

describe('Command Focus migrations', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    `)
    await db.exec(await readFile('supabase/migrations/20260921115103_foundation.sql', 'utf8'))
    for (const file of (await readdir('supabase/migrations')).filter(name => name !== '20260921115103_foundation.sql').sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    await db.query('insert into auth.users(id) values ($1),($2)', [owner, other])
    await db.query('insert into public.app_memberships(user_id) values ($1),($2)', [owner, other])
  })
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  describe('initiatives and programs become Proposed projects', () => {
    it('accepts the Proposed project status and nothing else new', async () => {
      await item('project', 'Proposed work', { status: 'Proposed' })
      await db.exec('savepoint bad')
      await expect(item('task', 'Bad', { status: 'Proposed' })).rejects.toThrow(/work_status/)
      await db.exec('rollback to savepoint bad')
    })
    it('converts each record, preserves content, records its origin and archives the original', async () => {
      const initiative = await item('initiative', 'HCPA Radar Agent', { body: 'Watch agent', current_state: 'Scoping', tags: ['ai'], due_date: '2026-12-30' })
      const program = await item('program', 'Standalone program', { goals: 'Existing goal', details: { definition: 'What it is' }, priority: 'High' })
      const result = (await one("select public.focus_fold_to_projects('[]'::jsonb) r")).r as { converted: number; merged_pairs: number }
      expect(result).toEqual({ converted: 2, merged_pairs: 0 })
      const projects = (await db.query<Row>("select * from public.work_items where kind='project' order by title")).rows
      expect(projects).toHaveLength(2)
      const radar = projects.find(p => p.title === 'HCPA Radar Agent')!
      expect(radar).toMatchObject({ status: 'Proposed', body: 'Watch agent', current_state: 'Scoping', tags: ['ai'], archived: false, version: 1 })
      expect(String(radar.due_date)).toContain('2026')
      expect((radar.details as Row).migrated_from).toBe(`initiative:${initiative}`)
      const standalone = projects.find(p => p.title === 'Standalone program')!
      // An existing goal is kept and the definition is not lost.
      expect(standalone).toMatchObject({ goals: 'Existing goal', priority: 'High' })
      expect(String(standalone.body)).toContain('Definition: What it is')
      expect((standalone.details as Row)).toMatchObject({ definition: 'What it is', migrated_from: `program:${program}` })
      const originals = (await db.query<Row>("select id,archived,details from public.work_items where kind in ('initiative','program')")).rows
      expect(originals.every(r => r.archived === true && typeof (r.details as Row).migrated_to === 'string')).toBe(true)
    })
    it('uses the definition as goals when there are none', async () => {
      await item('program', 'Defined', { details: { definition: 'Automate intake' } })
      await db.query("select public.focus_fold_to_projects('[]'::jsonb)")
      expect((await one("select goals from public.work_items where kind='project'")).goals).toBe('Automate intake')
    })
    it('merges the Variance Map pair into one project that records both origins', async () => {
      const initiative = await item('initiative', 'Create a GIS AI Agent to do Variance Maps')
      const program = await item('program', 'Automated Variance Map Intake, Generation and Distribution', { due_date: '2026-10-16', tags: ['GIS'], details: { definition: 'End to end maps' }, body: 'Intake to distribution' })
      const merge = JSON.stringify([{ keep_title: 'Automated Variance Map Intake, Generation and Distribution', fold_title: 'Create a GIS AI Agent to do Variance Maps' }])
      expect((await one('select public.focus_fold_to_projects($1::jsonb) r', [merge])).r).toEqual({ converted: 2, merged_pairs: 1 })
      const projects = (await db.query<Row>("select * from public.work_items where kind='project'")).rows
      expect(projects).toHaveLength(1)
      expect(projects[0]).toMatchObject({ title: 'Automated Variance Map Intake, Generation and Distribution', status: 'Proposed', tags: ['GIS'] })
      expect((projects[0]!.details as Row).migrated_from).toBe(`program:${program};initiative:${initiative}`)
      expect(String(projects[0]!.body)).toContain('Merged from initiative "Create a GIS AI Agent to do Variance Maps"')
      expect((await db.query("select 1 from public.work_items where kind in ('initiative','program') and not archived")).rows).toHaveLength(0)
    })
    it('re-points links without overriding an existing project, and is safe to run twice', async () => {
      const initiative = await item('initiative', 'Initiative')
      const existing = await item('project', 'Existing project')
      const linked = await item('task', 'Linked task', { initiative_id: initiative })
      const kept = await item('task', 'Already in a project', { initiative_id: initiative, project_id: existing })
      await db.query("select public.focus_fold_to_projects('[]'::jsonb)")
      const created = (await one("select id from public.work_items where kind='project' and details ? 'migrated_from'")).id
      expect((await one('select project_id from public.work_items where id=$1', [linked])).project_id).toBe(created)
      expect((await one('select project_id from public.work_items where id=$1', [kept])).project_id).toBe(existing)
      expect((await one("select public.focus_fold_to_projects('[]'::jsonb) r")).r).toEqual({ converted: 0, merged_pairs: 0 })
    })
    it('keeps the new function server-only', async () => {
      const grants = await db.query<{ role: string; allowed: boolean }>("select role, has_function_privilege(role,'public.focus_fold_to_projects(jsonb)','EXECUTE') allowed from (values ('anon'),('authenticated'),('service_role')) r(role)")
      expect(grants.rows.map(r => r.allowed)).toEqual([false, false, true])
    })
  })

  describe('Close the Day', () => {
    const close = (actions: unknown[], opts: { first?: string | null; finish?: boolean; mail?: unknown[]; counts?: object; user?: string } = {}) =>
      one('select public.apply_day_close($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8::jsonb) r',
        [opts.user ?? owner, '2026-10-19', JSON.stringify(actions), opts.first ?? null, opts.finish ?? false, 'web', JSON.stringify(opts.mail ?? []), JSON.stringify(opts.counts ?? {})]).then(r => r.r as { applied: Row; counts: Row; receipt_id: string | null })
    const ver = async (id: string) => Number((await one('select version from public.work_items where id=$1', [id])).version)

    it('completes, reschedules and archives in one transaction and writes a receipt', async () => {
      const a = await item('task', 'Finish report', { due_date: '2026-10-19' })
      const b = await item('task', 'Roll me', { due_date: '2026-10-19' })
      const c = await item('reminder', 'Drop me', { due_date: '2026-10-01' })
      const result = await close([
        { id: a, version: await ver(a), op: 'done' },
        { id: b, version: await ver(b), op: 'date', date: '2026-10-20' },
        { id: c, version: await ver(c), op: 'drop' },
      ], { finish: true })
      expect(result.applied).toEqual({ done: 1, rolled: 1, dropped: 1, converted: 0 })
      expect((await one('select status, completed_at is not null done from public.work_items where id=$1', [a]))).toMatchObject({ status: 'Complete', done: true })
      expect((await one("select to_char(due_date,'YYYY-MM-DD') d from public.work_items where id=$1", [b])).d).toBe('2026-10-20')
      expect((await one('select archived, status from public.work_items where id=$1', [c]))).toEqual({ archived: true, status: 'Active' })
      const receipt = await one('select * from public.day_closes')
      expect(receipt.counts).toEqual({ done: 1, rolled: 1, dropped: 1, converted: 0 })
      expect((await one("select count(*)::int n from public.usage_events where event='day_close'")).n).toBe(1)
    })
    it('refuses a stale version, a closed or unknown record and duplicates, applying nothing', async () => {
      const a = await item('task', 'A'); const b = await item('task', 'B')
      const v = await ver(a)
      await db.exec('savepoint s1')
      await expect(close([{ id: a, version: v, op: 'done' }, { id: b, version: 99, op: 'done' }])).rejects.toThrow(/changed since it was read/)
      await db.exec('rollback to savepoint s1')
      expect((await one('select status from public.work_items where id=$1', [a])).status).toBe('Inbox')
      await db.exec('savepoint s2')
      await expect(close([{ id: a, version: v, op: 'done' }, { id: a, version: v, op: 'drop' }])).rejects.toThrow(/once/)
      await db.exec('rollback to savepoint s2')
      await db.exec('savepoint s3')
      await expect(close([{ id: '33333333-3333-4333-8333-333333333333', version: 1, op: 'done' }])).rejects.toThrow(/unavailable/)
      await db.exec('rollback to savepoint s3')
      await db.exec('savepoint s4')
      await expect(close([{ id: a, version: v, op: 'date', date: 'tomorrow' }])).rejects.toThrow(/Invalid action/)
      await db.exec('rollback to savepoint s4')
    })
    it("never touches another owner's records", async () => {
      const mine = await item('task', 'Mine')
      await db.exec('savepoint s5')
      await expect(close([{ id: mine, version: await ver(mine), op: 'done' }], { user: other })).rejects.toThrow(/unavailable/)
      await db.exec('rollback to savepoint s5')
    })
    it('keeps a timed reminder at its New York clock time and un-snoozes it when moved', async () => {
      const r = await item('reminder', 'Call', { remind_at: '2026-10-19T14:30:00-04:00', status: 'Snoozed', snoozed_until: '2026-10-19T16:00:00-04:00' })
      await close([{ id: r, version: await ver(r), op: 'date', date: '2026-10-22' }])
      expect(await one("select to_char(remind_at at time zone 'America/New_York','YYYY-MM-DD HH24:MI') t, status, snoozed_until from public.work_items where id=$1", [r])).toEqual({ t: '2026-10-22 14:30', status: 'Active', snoozed_until: null })
    })
    it("sets tomorrow's first item as the only priority slot 1 and rejects anything but an open task", async () => {
      const old = await item('task', 'Old first', { focus_slot: 1 })
      const next = await item('task', 'Next first', { focus_slot: 2 })
      await close([], { first: next })
      expect((await one('select focus_slot from public.work_items where id=$1', [next])).focus_slot).toBe(1)
      expect((await one('select focus_slot from public.work_items where id=$1', [old])).focus_slot).toBeNull()
      const reminder = await item('reminder', 'Not a task')
      await db.exec('savepoint s6')
      await expect(close([], { first: reminder })).rejects.toThrow(/open task/)
      await db.exec('rollback to savepoint s6')
      const receipt = await close([], { first: next, finish: true })
      expect((await one('select first_item_id from public.day_closes where id=$1', [receipt.receipt_id])).first_item_id).toBe(next)
    })
    it('converts flagged mail to a task, reminder, Waiting On item or dismissal and counts them', async () => {
      const mail = (id: string, action: string, extra: Row = {}) => ({ message_id: id, conversation_id: 'c', action, title: `From ${id}`, due: '2026-10-25', url: 'https://outlook.office.com/mail/x', ...extra })
      const result = await close([], { finish: true, counts: { done: 2 }, mail: [mail('m1', 'task'), mail('m2', 'reminder'), mail('m3', 'waiting'), mail('m4', 'dismissed', { title: '' })] })
      expect(result.applied).toEqual({ done: 0, rolled: 0, dropped: 1, converted: 3 })
      expect(result.counts).toEqual({ done: 2, rolled: 0, dropped: 1, converted: 3 })
      expect((await db.query<Row>("select kind,status from public.work_items where title like 'From m%' order by title")).rows).toEqual([{ kind: 'task', status: 'Inbox' }, { kind: 'reminder', status: 'Active' }, { kind: 'waiting', status: 'Active' }])
      // Replaying the same message creates nothing new.
      expect((await close([], { mail: [mail('m1', 'task')] })).applied).toEqual({ done: 0, rolled: 0, dropped: 0, converted: 0 })
    })
    it('runs under a signed-in owner with row-level security and rejects forged counts', async () => {
      const t = await item('task', 'RLS task')
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      expect((await close([{ id: t, version: 1, op: 'done' }], { finish: true })).applied).toMatchObject({ done: 1 })
      await db.exec('savepoint s7')
      await expect(close([], { user: other })).rejects.toThrow(/Access unavailable/)
      await db.exec('rollback to savepoint s7')
      await db.exec('savepoint s8')
      await expect(close([], { counts: { done: 5000 } })).rejects.toThrow(/Invalid counts/)
      await db.exec('rollback to savepoint s8')
      expect((await db.query('select * from public.day_closes')).rows).toHaveLength(1)
      await db.exec('reset role')
    })
    it('keeps receipts and metrics owner-only, and Command Brief history read-only', async () => {
      await close([], { finish: true })
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: other, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      expect((await db.query('select * from public.day_closes')).rows).toHaveLength(0)
      expect((await db.query('select * from public.usage_events')).rows).toHaveLength(0)
      await db.exec('reset role')
      const priv = await db.query<{ role: string; w: boolean; r: boolean }>("select role, has_table_privilege(role,'public.cora_workday_reviews','INSERT') w, has_table_privilege(role,'public.cora_workday_reviews','SELECT') r from (values ('authenticated'),('service_role')) x(role)")
      expect(priv.rows).toEqual([{ role: 'authenticated', w: false, r: true }, { role: 'service_role', w: false, r: true }])
    })
  })
})
