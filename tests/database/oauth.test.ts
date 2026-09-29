import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const h = (c: string) => c.repeat(43)
let db: PGlite
let client: string
type Result = { ok: boolean }
const redeem = async (code: string, challenge = h('c'), redirect = 'https://claude.ai/api/mcp/auth_callback', id = client, access = h('a'), refresh = h('r')) =>
  (await db.query<{ r: Result }>('select public.cora_oauth_redeem($1,$2,$3,$4,$5,$6,3600) r', [code, id, redirect, challenge, access, refresh])).rows[0]!.r
const refresh = async (old: string, next: string, access: string, id = client) =>
  (await db.query<{ r: Result }>('select public.cora_oauth_refresh($1,$2,$3,$4,3600) r', [old, id, next, access])).rows[0]!.r
const verify = async (hash: string) => (await db.query<{ r: { user_id: string } | null }>('select public.cora_oauth_verify($1) r', [hash])).rows[0]!.r
const code = (hash = h('k'), user = owner, minutes = 5) => db.query(
  "insert into public.cora_oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,expires_at) values ($1,$2,$3,'https://claude.ai/api/mcp/auth_callback',$4,now()+make_interval(mins=>$5))", [hash, client, user, h('c'), minutes])

describe("Command's OAuth server", () => {
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
    await db.query('insert into public.app_memberships(user_id) values ($1)', [owner])
  })
  beforeEach(async () => {
    await db.exec('begin')
    client = (await db.query<{ id: string }>("select public.cora_oauth_register('Claude',array['https://claude.ai/api/mcp/auth_callback']) id")).rows[0]!.id
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('keeps every OAuth table and function server-only', async () => {
    const tables = ['cora_oauth_clients', 'cora_oauth_codes', 'cora_oauth_grants', 'cora_oauth_access']
    for (const table of tables) {
      const grants = await db.query<{ role: string; allowed: boolean }>(`select role, has_table_privilege(role,'public.${table}','SELECT') allowed from (values ('anon'),('authenticated'),('service_role')) r(role)`)
      expect(grants.rows.map(r => r.allowed)).toEqual([false, false, true])
    }
    const fns = await db.query<{ role: string; allowed: boolean }>("select role, has_function_privilege(role,'public.cora_oauth_verify(text)','EXECUTE') allowed from (values ('anon'),('authenticated'),('service_role')) r(role)")
    expect(fns.rows.map(r => r.allowed)).toEqual([false, false, true])
  })
  it('redeems a code once and verifies the resulting access token', async () => {
    await code()
    expect(await redeem(h('k'))).toEqual({ ok: true })
    expect(await verify(h('a'))).toMatchObject({ user_id: owner })
    expect(await verify(h('z'))).toBeNull()
    expect(await redeem(h('k'), h('c'), undefined, client, h('b'), h('s'))).toEqual({ ok: false })
  })
  it('burns the code on a wrong verifier, redirect or client', async () => {
    const wrong: [string?, string?, string?][] = [[h('x')], [h('c'), 'https://claude.ai/other'], [h('c'), undefined, '33333333-3333-4333-8333-333333333333']]
    for (const bad of wrong) {
      await code()
      expect(await redeem(h('k'), ...bad)).toEqual({ ok: false })
      expect(await redeem(h('k'))).toEqual({ ok: false })
    }
    expect((await db.query('select * from public.cora_oauth_grants')).rows).toHaveLength(0)
  })
  it('rejects expired codes and inactive owners', async () => {
    await code(h('k'), owner, -1)
    expect(await redeem(h('k'))).toEqual({ ok: false })
    await db.query('insert into public.app_memberships(user_id,active) values ($1,false)', [other])
    await code(h('k'), other)
    expect(await redeem(h('k'))).toEqual({ ok: false })
  })
  it('rotates refresh tokens, tolerating a lost response and parallel refreshes', async () => {
    await code(); await redeem(h('k'))
    expect(await refresh(h('r'), h('1'), h('b'))).toEqual({ ok: true })
    // The client never saw the first result and retries with the original token.
    expect(await refresh(h('r'), h('2'), h('c'))).toEqual({ ok: true })
    // Both new refresh tokens and every access token issued so far still work.
    expect(await refresh(h('1'), h('3'), h('d'))).toEqual({ ok: true })
    for (const access of ['a', 'b', 'c', 'd']) expect(await verify(h(access))).toMatchObject({ user_id: owner })
    // The fourth rotation pushes the original refresh token out.
    expect(await refresh(h('3'), h('4'), h('e'))).toEqual({ ok: true })
    expect(await refresh(h('r'), h('5'), h('f'))).toEqual({ ok: false })
    expect(await refresh(h('9'), h('5'), h('f'))).toEqual({ ok: false })
    expect(await refresh(h('4'), h('5'), h('f'), '33333333-3333-4333-8333-333333333333')).toEqual({ ok: false })
  })
  it('expires access tokens independently of the grant and slides the refresh window', async () => {
    await code(); await redeem(h('k'))
    await db.query("update public.cora_oauth_access set expires_at=now()-interval '1 second'")
    expect(await verify(h('a'))).toBeNull()
    await db.query("update public.cora_oauth_grants set refresh_expires_at=now()+interval '1 day'")
    expect(await refresh(h('r'), h('1'), h('b'))).toEqual({ ok: true })
    const { rows } = await db.query<{ days: number }>("select extract(day from refresh_expires_at-now())::int days from public.cora_oauth_grants")
    expect(rows[0]!.days).toBeGreaterThanOrEqual(89)
    expect(await verify(h('b'))).toMatchObject({ user_id: owner })
  })
  it('caps a grant at one year and refuses a lapsed refresh token', async () => {
    await code(); await redeem(h('k'))
    await db.query("update public.cora_oauth_grants set created_at=now()-interval '360 days'")
    await refresh(h('r'), h('1'), h('b'))
    const { rows } = await db.query<{ days: number }>("select extract(day from refresh_expires_at-now())::int days from public.cora_oauth_grants")
    expect(rows[0]!.days).toBeLessThanOrEqual(5)
    await db.query("update public.cora_oauth_grants set refresh_expires_at=now()-interval '1 second'")
    expect(await refresh(h('1'), h('2'), h('c'))).toEqual({ ok: false })
    expect(await verify(h('b'))).toBeNull()
  })
  it('replaces the earlier grant when the same client reconnects and removes grants on revocation', async () => {
    await code(); await redeem(h('k'))
    await code(h('m')); await redeem(h('m'), h('c'), undefined, client, h('b'), h('s'))
    expect(await verify(h('a'))).toBeNull()
    expect(await verify(h('b'))).toMatchObject({ user_id: owner })
    await db.query('update public.app_memberships set active=false where user_id=$1', [owner])
    expect(await verify(h('b'))).toBeNull()
    expect((await db.query('select * from public.cora_oauth_grants')).rows).toHaveLength(0)
  })
  it('bounds registration by pruning unused clients and then refusing new ones', async () => {
    await db.query("update public.cora_oauth_clients set created_at=now()-interval '2 days'")
    const one = () => db.query("select public.cora_oauth_register('x',array['http://localhost:1/cb'])")
    for (let i = 0; i < 100; i++) await one()
    await db.exec('savepoint capped')
    await expect(one()).rejects.toThrow(/Too many/)
    await db.exec('rollback to savepoint capped')
    await db.query("update public.cora_oauth_clients set created_at=now()-interval '2 days'")
    await one()
    expect(Number((await db.query<{ n: number }>('select count(*)::int n from public.cora_oauth_clients')).rows[0]!.n)).toBe(1)
  })
})
