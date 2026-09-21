import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const unapproved = '33333333-3333-4333-8333-333333333333'
let db: PGlite
async function authenticate(id: string, anonymous = false) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', is_anonymous: anonymous })])
  await db.exec('set local role authenticated')
}

describe('PostgreSQL foundation authorization', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    `)
    await db.exec(await readFile('supabase/migrations/20260921115103_foundation.sql', 'utf8'))
    await db.query('insert into auth.users(id) values ($1),($2),($3)', [owner, other, unapproved])
    await db.query('insert into public.app_memberships(user_id) values ($1),($2)', [owner, other])
  })
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('denies signed-out direct access', async () => {
    await db.exec('set local role anon')
    await expect(db.query('select * from public.user_preferences')).rejects.toThrow(/permission denied/)
  })
  it('denies an authenticated account without app membership', async () => {
    await authenticate(unapproved)
    expect((await db.query('select * from public.user_preferences')).rows).toHaveLength(0)
    await expect(db.query('insert into public.app_memberships(user_id) values ($1)', [unapproved])).rejects.toThrow(/permission denied/)
  })
  it('filters another approved user’s records and audit events', async () => {
    await authenticate(owner)
    expect((await db.query('select * from public.user_preferences')).rows).toHaveLength(1)
    expect((await db.query('select * from public.user_preferences where user_id=$1', [other])).rows).toHaveLength(0)
    expect((await db.query('select * from public.activity_log where user_id=$1', [other])).rows).toHaveLength(0)
  })
  it('disallows anonymous-auth accounts even with an accidental membership', async () => {
    await authenticate(owner, true)
    expect((await db.query('select * from public.user_preferences')).rows).toHaveLength(0)
  })
  it('persists an allowed update, increments its version and atomically audits it', async () => {
    await authenticate(owner)
    const result = await db.query<{ theme: string; version: number }>('update public.user_preferences set theme=$1 where user_id=$2 and version=1 returning theme,version', ['light', owner])
    expect(result.rows[0]).toEqual({ theme: 'light', version: 2 })
    const events = await db.query<{ actor_id: string }>("select actor_id from public.activity_log where action='UPDATE' and entity_type='user_preferences'")
    expect(events.rows).toEqual([{ actor_id: owner }])
  })
  it('does not overwrite a concurrent edit with an obsolete version', async () => {
    await authenticate(owner)
    await db.query('update public.user_preferences set theme=$1 where user_id=$2 and version=1', ['light', owner])
    expect((await db.query('update public.user_preferences set theme=$1 where user_id=$2 and version=1 returning user_id', ['system', owner])).rows).toHaveLength(0)
  })
  it('cannot reassign ownership', async () => {
    await authenticate(owner)
    await expect(db.query('update public.user_preferences set user_id=$1 where user_id=$2', [unapproved, owner])).rejects.toThrow(/permission denied/)
  })
  it('cannot elevate membership or alter audit history', async () => {
    await authenticate(owner)
    await expect(db.query('update public.app_memberships set active=false where user_id=$1', [owner])).rejects.toThrow(/permission denied/)
  })
  it('cannot forge audit records', async () => {
    await authenticate(owner)
    await expect(db.query("insert into public.activity_log(user_id,action,entity_type) values ($1,'UPDATE','user_preferences')", [owner])).rejects.toThrow(/permission denied/)
  })
  it('cannot delete audit records', async () => {
    await authenticate(owner)
    await expect(db.query('delete from public.activity_log')).rejects.toThrow(/permission denied/)
  })
  it('cannot execute the privileged trigger functions directly', async () => {
    await authenticate(owner)
    await expect(db.query('select private.provision_preferences()')).rejects.toThrow(/permission denied/)
  })
  it('revocation blocks access even while the old JWT still exists', async () => {
    await db.query('update public.app_memberships set active=false where user_id=$1',[owner])
    await authenticate(owner)
    expect((await db.query('select * from public.user_preferences')).rows).toHaveLength(0)
    expect((await db.query("update public.user_preferences set theme='light' where user_id=$1 returning user_id",[owner])).rows).toHaveLength(0)
  })
  it('rejects invalid preference values', async () => {
    await authenticate(owner)
    await expect(db.query("update public.user_preferences set theme='invalid' where user_id=$1", [owner])).rejects.toThrow(/check constraint/)
  })
  it('restores an exported synthetic preference in an isolated transaction', async () => {
    const before = (await db.query<{ user_id:string;theme:string;timezone:string }>('select user_id,theme,timezone from public.user_preferences where user_id=$1',[owner])).rows[0]!
    await db.query('delete from public.user_preferences where user_id=$1',[owner])
    await db.query('insert into public.user_preferences(user_id,theme,timezone) values ($1,$2,$3)',[before.user_id,before.theme,before.timezone])
    await authenticate(owner)
    expect((await db.query('select user_id,theme,timezone from public.user_preferences')).rows).toEqual([before])
  })
})
