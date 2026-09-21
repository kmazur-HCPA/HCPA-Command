-- One explicit app membership per approved user. Authentication alone grants no data access.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

create table public.app_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid primary key references public.app_memberships(user_id) on delete cascade,
  theme text not null default 'dark' check (theme in ('system', 'dark', 'light')),
  timezone text not null default 'America/New_York' check (timezone = 'America/New_York'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity_type text not null check (entity_type in ('app_memberships', 'user_preferences')),
  occurred_at timestamptz not null default now()
);
create index activity_log_owner_time_idx on public.activity_log(user_id, occurred_at desc);

alter table public.app_memberships enable row level security;
alter table public.user_preferences enable row level security;
alter table public.activity_log enable row level security;
revoke all on public.app_memberships, public.user_preferences, public.activity_log from public, anon, authenticated;
grant select on public.app_memberships, public.user_preferences, public.activity_log to authenticated;
grant update (theme, timezone) on public.user_preferences to authenticated;
-- Trusted administrative provisioning only, never used by the browser or ordinary server requests.
grant all on public.app_memberships, public.user_preferences, public.activity_log to service_role;

create policy membership_self on public.app_memberships for select to authenticated
  using (user_id = (select auth.uid()) and active and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);
create policy preferences_read on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active));
create policy preferences_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active));
create policy activity_read on public.activity_log for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active));

create function private.update_preference_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Record ownership cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger preference_version before update on public.user_preferences
  for each row execute function private.update_preference_version();

-- Definer rights are limited to trigger-only provisioning/audit inserts, in a non-exposed schema.
-- No dynamic SQL, no parameters, and no client EXECUTE privilege.
create function private.provision_preferences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'app_memberships' or tg_op <> 'INSERT' then
    raise exception 'Invalid provisioning context';
  end if;
  insert into public.user_preferences(user_id) values (new.user_id);
  return new;
end;
$$;
create trigger membership_preferences after insert on public.app_memberships
  for each row execute function private.provision_preferences();

create function private.audit_foundation_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected_user uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('app_memberships', 'user_preferences') then
    raise exception 'Invalid audit context';
  end if;
  affected_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  insert into public.activity_log(user_id, actor_id, action, entity_type)
    values (affected_user, auth.uid(), tg_op, tg_table_name);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger membership_audit after insert or update or delete on public.app_memberships
  for each row execute function private.audit_foundation_change();
create trigger preferences_audit after insert or update or delete on public.user_preferences
  for each row execute function private.audit_foundation_change();
revoke all on function private.update_preference_version(), private.provision_preferences(), private.audit_foundation_change() from public, anon, authenticated;

comment on table public.app_memberships is 'Admin-provisioned Command access. An authenticated account without an active membership has no business data access.';
comment on table public.activity_log is 'Append-only to API users. Trigger-generated mutation metadata contains no credentials or business-content bodies.';
