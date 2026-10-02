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
describe('Stand-up items', () => {
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

  const add = (user: string, week: string, body: string) =>
    db.query('insert into public.standup_items(user_id,week_start,body) values ($1,$2,$3)', [user, week, body])

  it('keeps items private to their owner', async () => {
    await authenticate(owner)
    await add(owner, '2026-10-06', 'Duo MFA follow-up')
    await db.exec('reset role'); await authenticate(other)
    expect((await db.query('select 1 from public.standup_items')).rows).toHaveLength(0)
    await db.exec('savepoint s')
    await expect(add(owner, '2026-10-06', 'Not mine')).rejects.toThrow(/row-level security/)
    await db.exec('rollback to savepoint s')
    expect((await db.query("delete from public.standup_items returning id")).rows).toHaveLength(0)
  })
  it('only allows weeks that start on a Tuesday', async () => {
    await authenticate(owner)
    await db.exec('savepoint s')
    await expect(add(owner, '2026-10-05', 'Monday start')).rejects.toThrow(/check constraint/)
    await db.exec('rollback to savepoint s')
    await add(owner, '2026-10-06', 'Tuesday start')
  })
  it('limits text to 1-300 characters and lets only the text change', async () => {
    await authenticate(owner)
    await db.exec('savepoint s')
    await expect(add(owner, '2026-10-06', '   ')).rejects.toThrow(/check constraint/)
    await db.exec('rollback to savepoint s')
    await db.exec('savepoint t')
    await expect(add(owner, '2026-10-06', 'x'.repeat(301))).rejects.toThrow(/check constraint/)
    await db.exec('rollback to savepoint t')
    await add(owner, '2026-10-06', 'Original')
    await db.query("update public.standup_items set body='Edited'")
    expect((await db.query('select body from public.standup_items')).rows).toEqual([{ body: 'Edited' }])
    await db.query("update public.standup_items set done=true")
    expect((await db.query('select done from public.standup_items')).rows).toEqual([{ done: true }])
    await db.exec('savepoint u')
    await expect(db.query("update public.standup_items set week_start='2026-10-13'")).rejects.toThrow(/permission denied/)
  })
  it('shows a new week blank while earlier weeks remain, and a carried item points back', async () => {
    await authenticate(owner)
    await add(owner, '2026-09-29', 'Old item')
    const old = (await db.query<{ id: string }>('select id from public.standup_items')).rows[0]!.id
    expect((await db.query("select 1 from public.standup_items where week_start='2026-10-06'")).rows).toHaveLength(0)
    await db.query('insert into public.standup_items(user_id,week_start,body,carried_from) values ($1,$2,$3,$4)', [owner, '2026-10-06', 'Old item', old])
    expect((await db.query("select carried_from from public.standup_items where week_start='2026-10-06'")).rows).toEqual([{ carried_from: old }])
    await db.query('delete from public.standup_items where id=$1', [old])
    expect((await db.query("select carried_from from public.standup_items where week_start='2026-10-06'")).rows).toEqual([{ carried_from: null }])
  })
})
