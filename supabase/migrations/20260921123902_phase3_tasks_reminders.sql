create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_memberships(user_id),
  kind text not null,
  title text not null check (length(btrim(title)) between 1 and 240),
  body text not null default '' check (length(body) <= 50000),
  original_body text not null default '',
  status text not null,
  priority text not null default 'Normal' check (priority in ('Critical','High','Normal','Low')),
  due_date date,
  remind_at timestamptz,
  snoozed_until timestamptz,
  completed_at timestamptz,
  converted_task_id uuid references public.work_items(id),
  archived boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_kind check (kind in ('task','reminder')),
  constraint work_status check (
    (kind='task' and status in ('Inbox','Next','In Progress','Waiting','Scheduled','Someday','Complete','Cancelled')) or
    (kind='reminder' and status in ('Active','Snoozed','Complete','Dismissed'))),
  constraint reminder_schedule check (not (due_date is not null and remind_at is not null) and (status<>'Snoozed' or snoozed_until is not null)),
  unique(user_id,id)
);
create index work_owner_kind_time on public.work_items(user_id,kind,archived,created_at desc,id);
create index work_owner_due on public.work_items(user_id,due_date) where not archived;
create index work_converted on public.work_items(converted_task_id) where converted_task_id is not null;
alter table public.work_items enable row level security;
revoke all on public.work_items from public,anon,authenticated;
grant select,insert,update on public.work_items to authenticated;
grant all on public.work_items to service_role;
create policy work_owner on public.work_items for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

create function private.guard_work_item() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.original_body:=new.body; new.version:=1; new.created_at:=clock_timestamp();
 else
   if new.id<>old.id or new.user_id<>old.user_id or new.kind<>old.kind then raise exception 'Identity cannot change' using errcode='42501'; end if;
   if old.converted_task_id is not null and new.converted_task_id is distinct from old.converted_task_id then raise exception 'A converted reminder cannot be detached from its task' using errcode='23514'; end if;
   new.original_body:=old.original_body; new.created_at:=old.created_at; new.version:=old.version+1;
 end if;
 new.updated_at:=clock_timestamp();
 new.completed_at:=case when new.status='Complete' then coalesce(new.completed_at,clock_timestamp()) else null end;
 if new.converted_task_id is not null and not exists(select 1 from public.work_items where id=new.converted_task_id and user_id=new.user_id and kind='task') then raise exception 'Invalid task link' using errcode='23514'; end if;
 return new;
end $$;
create trigger work_guard before insert or update on public.work_items for each row execute function private.guard_work_item();
alter table public.activity_log add column entity_id uuid;
create index activity_work_entity on public.activity_log(user_id,entity_id,occurred_at desc) where entity_id is not null;
alter table public.activity_log drop constraint activity_log_entity_type_check;
alter table public.activity_log add constraint activity_log_entity_type_check check(entity_type in ('app_memberships','user_preferences','work_items'));
create function private.audit_work() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'work_items' then raise exception 'Invalid audit context'; end if;
 insert into public.activity_log(user_id,actor_id,action,entity_type,entity_id) values(new.user_id,auth.uid(),tg_op,'work_items',new.id);
 return new;
end $$;
create trigger work_audit after insert or update on public.work_items for each row execute function private.audit_work();
revoke all on function private.guard_work_item(),private.audit_work() from public,anon,authenticated;

-- Invoker rights keep every step under the caller's RLS. Row lock serializes retries.
create function public.convert_reminder(reminder_id uuid, expected_version integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.work_items; target uuid;
begin
 select * into r from public.work_items where id=reminder_id and kind='reminder' for update;
 if not found then raise exception 'Reminder unavailable' using errcode='42501'; end if;
 if r.converted_task_id is not null then return r.converted_task_id; end if;
 if r.version<>expected_version or r.archived or r.status not in ('Active','Snoozed') then raise exception 'Reload this reminder before converting' using errcode='40001'; end if;
 insert into public.work_items(user_id,kind,title,body,status,priority,due_date)
 values(r.user_id,'task',r.title,r.body,'Inbox',r.priority,coalesce(r.due_date,(r.remind_at at time zone 'America/New_York')::date)) returning id into target;
 update public.work_items set converted_task_id=target,status='Complete',snoozed_until=null where id=r.id;
 return target;
end $$;
revoke all on function public.convert_reminder(uuid,integer) from public,anon;
grant execute on function public.convert_reminder(uuid,integer) to authenticated;
