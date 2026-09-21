-- Credentials are server-only, encrypted before they reach Postgres, and excluded
-- from workspace exports. Reconnect after recovery rather than restoring tokens.
create table public.microsoft_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation uuid not null,
  auth_state text unique,
  browser_hash text,
  verifier text,
  auth_expires_at timestamptz,
  token_cache text check (length(token_cache) <= 300000),
  account_id text,
  account_email text,
  connected_at timestamptz,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.microsoft_connections enable row level security;
revoke all on public.microsoft_connections from public, anon, authenticated;
grant select, insert, update, delete on public.microsoft_connections to service_role;
comment on table public.microsoft_connections is 'Server-only encrypted Microsoft delegated credentials. No mailbox content. Never export or log.';

-- Serialize credential changes with membership revocation. A request that
-- checked membership before a revocation cannot create credentials afterwards.
create function public.require_microsoft_membership() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.app_memberships where user_id = new.user_id and active for share;
  if not found then raise exception 'Command access unavailable' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function public.require_microsoft_membership() from public, anon, authenticated;
grant execute on function public.require_microsoft_membership() to service_role;
create trigger microsoft_require_membership before insert or update on public.microsoft_connections
for each row execute function public.require_microsoft_membership();

-- Revoking Command membership also removes persistent Microsoft access and all
-- pending connection attempts. This trigger needs no elevated privileges: the
-- existing administrative membership writer already has service-role access.
create function public.disconnect_microsoft_on_revocation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not new.active then
    delete from public.microsoft_connections where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.disconnect_microsoft_on_revocation() from public, anon, authenticated;
grant execute on function public.disconnect_microsoft_on_revocation() to service_role;
create trigger membership_disconnect_microsoft after update of active on public.app_memberships
for each row execute function public.disconnect_microsoft_on_revocation();
