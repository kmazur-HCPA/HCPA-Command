-- Monday stand-up: short items to raise, kept per stand-up week. A week runs Tuesday through
-- the following Monday (America/New_York), so each Tuesday starts blank with no scheduled job:
-- the app only ever shows the current week's rows. Earlier weeks remain for looking back.
create table public.standup_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_memberships(user_id),
  week_start date not null check (extract(isodow from week_start) = 2),
  body text not null check (length(btrim(body)) between 1 and 300),
  carried_from uuid references public.standup_items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index standup_items_week_idx on public.standup_items(user_id, week_start desc, created_at);
alter table public.standup_items enable row level security;
revoke all on public.standup_items from public, anon, authenticated;
grant select, insert, delete on public.standup_items to authenticated;
grant update (body) on public.standup_items to authenticated;
grant all on public.standup_items to service_role;
create policy standup_owner on public.standup_items for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_memberships m where m.user_id = (select auth.uid()) and m.active));
