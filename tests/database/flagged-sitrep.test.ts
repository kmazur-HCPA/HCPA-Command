import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
let db: PGlite
async function authenticate(id: string) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated' })])
  await db.exec('set local role authenticated')
}
const capture = (id: string, action: string, title: string | null = 'Budget follow-up', due: string | null = '2026-10-05') =>
  db.query<{ r: { created: boolean; action: string; record_id: string | null } }>(
    'select public.capture_flagged_email($1,$2,$3,$4,$5,$6,$7) r',
    [id, 'conv-1', action, title, due, 'Normal', 'https://outlook.office.com/mail/item'])

describe('Flagged mail capture and SITREP storage', () => {
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
    for (const file of (await readdir('supabase/migrations')).filter(n => n !== '20260921115103_foundation.sql').sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    await db.query('insert into auth.users(id) values ($1),($2)', [owner, other])
    await db.query('insert into public.app_memberships(user_id) values ($1),($2)', [owner, other])
  })
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('creates the task and capture row together, once, with only the source link in the body', async () => {
    await authenticate(owner)
    const first = (await capture('m1', 'task')).rows[0]!.r
    expect(first).toMatchObject({ created: true, action: 'task' })
    const again = (await capture('m1', 'task')).rows[0]!.r
    expect(again).toMatchObject({ created: false, record_id: first.record_id })
    const task = (await db.query<{ kind: string; title: string; due_date: string; body: string; status: string }>('select kind,title,due_date::text,body,status from public.work_items where id=$1', [first.record_id])).rows[0]!
    expect(task).toMatchObject({ kind: 'task', title: 'Budget follow-up', due_date: '2026-10-05', status: 'Inbox', body: 'Source: https://outlook.office.com/mail/item' })
    expect((await db.query("select count(*)::int n from public.work_items where title='Budget follow-up'")).rows[0]).toEqual({ n: 1 })
  })

  it('requires a reminder date and rolls back the record when the capture fails', async () => {
    await authenticate(owner)
    await db.exec('savepoint s')
    await expect(capture('m2', 'reminder', 'Call back', null)).rejects.toThrow(/Choose a date/)
    await db.exec('rollback to savepoint s')
    expect((await capture('m2', 'reminder', 'Call back', '2026-10-06')).rows[0]!.r).toMatchObject({ created: true, action: 'reminder' })
    expect((await db.query("select status from public.work_items where kind='reminder'")).rows).toEqual([{ status: 'Active' }])
  })

  it('dismisses, undoes a dismissal, and never undoes a capture', async () => {
    await authenticate(owner)
    expect((await capture('m3', 'dismissed', null, null)).rows[0]!.r).toMatchObject({ action: 'dismissed', record_id: null })
    await db.query("delete from public.email_captures where message_id='m3'")
    expect((await db.query("select * from public.email_captures where message_id='m3'")).rows).toHaveLength(0)
    await capture('m4', 'task')
    await db.query("delete from public.email_captures where message_id='m4'")
    expect((await db.query("select * from public.email_captures where message_id='m4'")).rows).toHaveLength(1)
    // A dismissed message can still be converted later.
    await capture('m5', 'dismissed', null, null)
    expect((await capture('m5', 'task')).rows[0]!.r).toMatchObject({ created: true, action: 'task' })
  })

  it('keeps captures private and blocks direct browser writes', async () => {
    await authenticate(owner)
    await capture('m6', 'task')
    await db.exec('savepoint s')
    await expect(db.query("insert into public.email_captures(user_id,message_id,action) values ($1,'x','task')", [owner])).rejects.toThrow()
    await db.exec('rollback to savepoint s')
    await expect(db.query("insert into public.email_captures(user_id,message_id,action) values ($1,'x','dismissed')", [other])).rejects.toThrow()
    await db.exec('rollback to savepoint s')
    await db.exec('reset role'); await authenticate(other)
    expect((await db.query('select * from public.email_captures')).rows).toHaveLength(0)
  })

  it('makes SITREP runs immutable after they finish and server-written only', async () => {
    const run = crypto.randomUUID()
    await db.query("insert into public.sitrep_runs(user_id,run_id,for_date,run_slot,status) values ($1,$2,'2026-10-01','am','running')", [owner, run])
    await db.query("update public.sitrep_runs set status='complete',payload='{\"x\":1}',generated_at=now() where run_id=$1", [run])
    await db.exec('savepoint c')
    await expect(db.query("update public.sitrep_runs set status='failed',payload=null,generated_at=null where run_id=$1", [run])).rejects.toThrow(/closed/)
    await db.exec('rollback to savepoint c')
    await db.exec('savepoint s')
    await expect(db.query("insert into public.sitrep_runs(user_id,run_id,for_date,run_slot,status) values ($1,$2,'2026-10-01','am','complete')", [owner, crypto.randomUUID()])).rejects.toThrow()
    await db.exec('rollback to savepoint s')
    await authenticate(owner)
    expect((await db.query('select run_id from public.sitrep_runs')).rows).toHaveLength(1)
    await db.exec('savepoint w')
    await expect(db.query("insert into public.sitrep_runs(user_id,run_id,for_date,run_slot,status) values ($1,$2,'2026-10-01','am','running')", [owner, crypto.randomUUID()])).rejects.toThrow()
    await db.exec('rollback to savepoint w')
    await db.exec('reset role'); await authenticate(other)
    expect((await db.query('select run_id from public.sitrep_runs')).rows).toHaveLength(0)
  })

  it('marks stale running rows failed and purges past retention', async () => {
    await db.query("insert into public.sitrep_runs(user_id,run_id,for_date,run_slot,status,started_at) values ($1,$2,'2026-10-01','am','running',now()-interval '2 hours'),($1,$3,'2026-08-01','am','failed',now()-interval '40 days')", [owner, crypto.randomUUID(), crypto.randomUUID()])
    expect((await db.query<{ r: unknown }>('select public.sitrep_maintenance(30) r')).rows[0]!.r).toEqual({ marked_failed: 1, purged: 1 })
  })
})
