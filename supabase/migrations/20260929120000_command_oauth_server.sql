-- Command's own OAuth 2.1 authorization server for the Claude connector.
-- Claude no longer depends on Supabase Auth JWT refresh or the browser session
-- time box. All tables and functions are server-only (service_role); tokens are
-- random 256-bit values and only their SHA-256 digests are stored.
create table public.cora_oauth_clients (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 100),
 redirect_uris text[] not null check(cardinality(redirect_uris) between 1 and 5),
 created_at timestamptz not null default now()
);
create table public.cora_oauth_codes (
 code_hash text primary key check(length(code_hash)=43),
 client_id uuid not null references public.cora_oauth_clients(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 redirect_uri text not null,
 code_challenge text not null check(length(code_challenge)=43),
 expires_at timestamptz not null
);
-- One grant per approved connection. The three newest refresh digests stay valid
-- so a lost response or parallel refresh never strands the client.
create table public.cora_oauth_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.cora_oauth_clients(id) on delete cascade,
 refresh_hashes text[] not null check(cardinality(refresh_hashes) between 1 and 3),
 refresh_expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 refreshed_at timestamptz,
 last_used_at timestamptz
);
create index cora_oauth_grants_owner on public.cora_oauth_grants(user_id);
create table public.cora_oauth_access (
 access_hash text primary key check(length(access_hash)=43),
 grant_id uuid not null references public.cora_oauth_grants(id) on delete cascade,
 expires_at timestamptz not null
);
create index cora_oauth_access_grant on public.cora_oauth_access(grant_id);
alter table public.cora_oauth_clients enable row level security;
alter table public.cora_oauth_codes enable row level security;
alter table public.cora_oauth_grants enable row level security;
alter table public.cora_oauth_access enable row level security;
revoke all on public.cora_oauth_clients,public.cora_oauth_codes,public.cora_oauth_grants,public.cora_oauth_access from public,anon,authenticated;
grant select,insert,update,delete on public.cora_oauth_clients,public.cora_oauth_codes,public.cora_oauth_grants,public.cora_oauth_access to service_role;

-- Deactivating the owner also ends every connected-app grant.
create or replace function public.disconnect_cora_mcp_on_revocation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not new.active then
  delete from public.cora_mcp_connections where user_id=new.user_id;
  delete from public.cora_oauth_grants where user_id=new.user_id;
  delete from public.cora_oauth_codes where user_id=new.user_id;
 end if;
 return new;
end $$;

-- Dynamic client registration (public clients only). Bounded so anonymous
-- registration cannot grow the table: unused clients are pruned, then capped.
create function public.cora_oauth_register(p_name text,p_uris text[]) returns uuid
language plpgsql security invoker set search_path='' as $$
declare client_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('cora_oauth_register',0));
 delete from public.cora_oauth_clients c where c.created_at<now()-interval '1 day'
  and not exists(select 1 from public.cora_oauth_grants g where g.client_id=c.id);
 if (select count(*) from public.cora_oauth_clients)>=100 then
  raise exception 'Too many registered clients' using errcode='P0001';
 end if;
 insert into public.cora_oauth_clients(name,redirect_uris) values(p_name,p_uris) returning id into client_id;
 return client_id;
end $$;

-- Exchanges a single-use authorization code. The code is consumed even when a
-- check fails. Returns {ok:false} instead of raising so that consumption commits.
create function public.cora_oauth_redeem(p_code_hash text,p_client uuid,p_redirect text,p_challenge text,
 p_access_hash text,p_refresh_hash text,p_access_seconds int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.cora_oauth_codes; grant_id uuid;
begin
 delete from public.cora_oauth_codes where code_hash=p_code_hash returning * into c;
 delete from public.cora_oauth_codes where expires_at<now();
 if c.code_hash is null or c.expires_at<=now() or c.client_id<>p_client or c.redirect_uri<>p_redirect or c.code_challenge<>p_challenge then
  return jsonb_build_object('ok',false);
 end if;
 perform 1 from public.app_memberships where user_id=c.user_id and active for share;
 if not found then return jsonb_build_object('ok',false); end if;
 -- Reconnecting replaces the earlier grant for the same client.
 delete from public.cora_oauth_grants where user_id=c.user_id and client_id=c.client_id;
 delete from public.cora_oauth_grants where refresh_expires_at<now();
 insert into public.cora_oauth_grants(user_id,client_id,refresh_hashes,refresh_expires_at)
  values(c.user_id,c.client_id,array[p_refresh_hash],now()+interval '90 days') returning id into grant_id;
 insert into public.cora_oauth_access(access_hash,grant_id,expires_at)
  values(p_access_hash,grant_id,now()+make_interval(secs=>p_access_seconds));
 return jsonb_build_object('ok',true);
end $$;

-- Rotates the refresh token. Lifetime slides 90 days from each use, capped at one
-- year from the original approval. Older access tokens stay valid until they expire.
create function public.cora_oauth_refresh(p_refresh_hash text,p_client uuid,p_new_refresh text,
 p_access_hash text,p_access_seconds int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g public.cora_oauth_grants;
begin
 select * into g from public.cora_oauth_grants
  where refresh_hashes @> array[p_refresh_hash] and client_id=p_client and refresh_expires_at>now() for update;
 if not found then return jsonb_build_object('ok',false); end if;
 perform 1 from public.app_memberships where user_id=g.user_id and active for share;
 if not found then return jsonb_build_object('ok',false); end if;
 update public.cora_oauth_grants set
  refresh_hashes=(array[p_new_refresh]||refresh_hashes)[1:3],
  refreshed_at=now(),
  refresh_expires_at=least(now()+interval '90 days',created_at+interval '365 days')
  where id=g.id;
 delete from public.cora_oauth_access where expires_at<now();
 insert into public.cora_oauth_access(access_hash,grant_id,expires_at)
  values(p_access_hash,g.id,now()+make_interval(secs=>p_access_seconds));
 return jsonb_build_object('ok',true);
end $$;

-- One round trip authenticates an MCP request: live token, live grant, active owner.
create function public.cora_oauth_verify(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g public.cora_oauth_grants;
begin
 select gr.* into g from public.cora_oauth_access a join public.cora_oauth_grants gr on gr.id=a.grant_id
  where a.access_hash=p_hash and a.expires_at>now() and gr.refresh_expires_at>now()
  and exists(select 1 from public.app_memberships m where m.user_id=gr.user_id and m.active);
 if not found then return null; end if;
 update public.cora_oauth_grants set last_used_at=now()
  where id=g.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 return jsonb_build_object('user_id',g.user_id,'grant_id',g.id,'client_id',g.client_id);
end $$;

revoke all on function public.cora_oauth_register(text,text[]),
 public.cora_oauth_redeem(text,uuid,text,text,text,text,int),
 public.cora_oauth_refresh(text,uuid,text,text,int),
 public.cora_oauth_verify(text) from public,anon,authenticated;
grant execute on function public.cora_oauth_register(text,text[]),
 public.cora_oauth_redeem(text,uuid,text,text,text,text,int),
 public.cora_oauth_refresh(text,uuid,text,text,int),
 public.cora_oauth_verify(text) to service_role;
