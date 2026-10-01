-- Flagged Outlook mail capture state and SITREP runs.
-- Neither table stores an email body, Teams text or Helix description. Capture
-- rows hold Graph immutable IDs only; the record Kevin accepts holds the title.

create table public.email_captures (
 user_id uuid not null references public.app_memberships(user_id),
 message_id text not null check(length(message_id) between 1 and 1500),
 conversation_id text check(length(conversation_id)<=1500),
 action text not null check(action in ('task','reminder','dismissed')),
 record_id uuid,
 captured_at timestamptz not null default now(),
 primary key(user_id,message_id),
 foreign key(user_id,record_id) references public.work_items(user_id,id),
 check((action='dismissed')=(record_id is null))
);
create index email_captures_record on public.email_captures(user_id,record_id) where record_id is not null;
alter table public.email_captures enable row level security;
revoke all on public.email_captures from public,anon,authenticated;
grant select,insert,delete on public.email_captures to authenticated;
grant all on public.email_captures to service_role;
create policy email_capture_owner_read on public.email_captures for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
-- Written by capture_flagged_email (invoker); the composite FK keeps record_id the owner's own.
create policy email_capture_owner_write on public.email_captures for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
-- Undo is only for dismissals; a captured message stays captured with its record.
create policy email_capture_owner_undo on public.email_captures for delete to authenticated
 using(action='dismissed' and user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

-- One transaction: the record and its capture row are written together or not at all.
-- Retrying the same message returns the original record instead of a second one.
create function public.capture_flagged_email(
 p_message_id text,p_conversation_id text,p_action text,
 p_title text,p_due date,p_priority text,p_source_url text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare me uuid:=(select auth.uid()); existing public.email_captures; target uuid;
begin
 if me is null or not exists(select 1 from public.app_memberships where user_id=me and active) then raise exception 'Access unavailable' using errcode='42501'; end if;
 if p_action not in ('task','reminder','dismissed') then raise exception 'Invalid capture action'; end if;
 if p_action<>'dismissed' then
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then raise exception 'Add a title'; end if;
  if p_action='reminder' and p_due is null then raise exception 'Choose a date for the reminder'; end if;
  if p_priority not in ('Critical','High','Normal','Low') then raise exception 'Invalid priority'; end if;
 end if;
 select * into existing from public.email_captures where user_id=me and message_id=p_message_id;
 -- A dismissed message may still be converted later; any other capture is final.
 if found and existing.action='dismissed' and p_action<>'dismissed' then
  delete from public.email_captures where user_id=me and message_id=p_message_id;
  existing:=null;
 end if;
 if existing.message_id is not null then
  return jsonb_build_object('captured',true,'created',false,'action',existing.action,'record_id',existing.record_id);
 end if;
 begin
  if p_action='dismissed' then
   insert into public.email_captures(user_id,message_id,conversation_id,action) values(me,p_message_id,p_conversation_id,'dismissed');
   return jsonb_build_object('captured',true,'created',true,'action','dismissed','record_id',null);
  end if;
  insert into public.work_items(user_id,kind,title,body,status,priority,due_date)
  values(me,p_action,btrim(p_title),
   case when p_source_url is null then '' else 'Source: '||p_source_url end,
   case when p_action='task' then 'Inbox' else 'Active' end,p_priority,p_due) returning id into target;
  insert into public.email_captures(user_id,message_id,conversation_id,action,record_id) values(me,p_message_id,p_conversation_id,p_action,target);
  return jsonb_build_object('captured',true,'created',true,'action',p_action,'record_id',target);
 exception when unique_violation then
  -- A concurrent call captured it first. This block's record insert is rolled back.
  select * into existing from public.email_captures where user_id=me and message_id=p_message_id;
  return jsonb_build_object('captured',true,'created',false,'action',existing.action,'record_id',existing.record_id);
 end;
end $$;
revoke all on function public.capture_flagged_email(text,text,text,text,date,text,text) from public,anon;
grant execute on function public.capture_flagged_email(text,text,text,text,date,text,text) to authenticated;

create table public.sitrep_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_memberships(user_id),
 run_id uuid not null unique,
 for_date date not null,
 run_slot text not null check(run_slot in ('am','midday','manual')),
 status text not null check(status in ('running','complete','partial','failed')),
 started_at timestamptz not null default now(),
 generated_at timestamptz,
 schema_version int not null default 1,
 sources jsonb not null default '{}' check(jsonb_typeof(sources)='object'),
 payload jsonb check(payload is null or octet_length(payload::text)<=32768),
 error_note text check(length(error_note)<=300),
 created_by text not null default 'cmd-scheduled-task',
 check((status in ('complete','partial'))=(payload is not null and generated_at is not null))
);
create index sitrep_runs_latest on public.sitrep_runs(user_id,for_date desc,generated_at desc) where status in ('complete','partial');
alter table public.sitrep_runs enable row level security;
revoke all on public.sitrep_runs from public,anon,authenticated;
grant select on public.sitrep_runs to authenticated;
grant all on public.sitrep_runs to service_role;
create policy sitrep_owner_read on public.sitrep_runs for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

-- Terminal rows are immutable. Only a running row may finish, once.
create function public.sitrep_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then return old; end if;
 if old.status<>'running' then raise exception 'SITREP run is closed' using errcode='23514'; end if;
 if new.user_id<>old.user_id or new.run_id<>old.run_id or new.for_date<>old.for_date or new.run_slot<>old.run_slot or new.started_at<>old.started_at then
  raise exception 'SITREP run identity cannot change' using errcode='23514';
 end if;
 return new;
end $$;
create trigger sitrep_runs_guard before update on public.sitrep_runs for each row execute function public.sitrep_guard();

-- Retention: default 30 days. Confirm with the records custodian before go-live.
-- Run nightly (Supabase cron or a scheduled function). Server-only.
create function public.sitrep_maintenance(p_retention_days int default 30) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare failed int; purged int;
begin
 update public.sitrep_runs set status='failed',error_note='Run did not finish within 30 minutes'
 where status='running' and started_at<now()-interval '30 minutes';
 get diagnostics failed=row_count;
 delete from public.sitrep_runs where started_at<now()-make_interval(days=>p_retention_days);
 get diagnostics purged=row_count;
 return jsonb_build_object('marked_failed',failed,'purged',purged);
end $$;
revoke all on function public.sitrep_maintenance(int) from public,anon,authenticated;
grant execute on function public.sitrep_maintenance(int) to service_role;
