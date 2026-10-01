-- Read-only Helix connection. Server-only, like microsoft_connections: tokens are encrypted
-- before they reach Postgres, never exported or logged. Reconnect after recovery.
-- `summary` caches the last Helix work summary (titles, numbers, statuses, priorities, dates only).
create table public.helix_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation uuid not null,
  auth_state text unique,
  browser_hash text,
  verifier text,
  auth_expires_at timestamptz,
  tokens text check (length(tokens) <= 20000),
  connected_at timestamptz,
  revision integer not null default 1,
  summary jsonb,
  summary_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.helix_connections enable row level security;
revoke all on public.helix_connections from public, anon, authenticated;
grant select, insert, update, delete on public.helix_connections to service_role;
comment on table public.helix_connections is 'Server-only encrypted Helix OAuth tokens and cached work summary. Never export or log.';

create function public.require_helix_membership() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.app_memberships where user_id = new.user_id and active for share;
  if not found then raise exception 'Command access unavailable' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function public.require_helix_membership() from public, anon, authenticated;
grant execute on function public.require_helix_membership() to service_role;
create trigger helix_require_membership before insert or update on public.helix_connections
for each row execute function public.require_helix_membership();

create function public.disconnect_helix_on_revocation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not new.active then
    delete from public.helix_connections where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.disconnect_helix_on_revocation() from public, anon, authenticated;
grant execute on function public.disconnect_helix_on_revocation() to service_role;
create trigger membership_disconnect_helix after update of active on public.app_memberships
for each row execute function public.disconnect_helix_on_revocation();
