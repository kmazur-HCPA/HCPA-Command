alter table public.work_items drop constraint work_kind;
alter table public.work_items add constraint work_kind check(kind in ('task','reminder','project','initiative','person','journal','waiting'));
alter table public.work_items drop constraint work_status;
alter table public.work_items add constraint work_status check(
 (kind='task' and status in ('Inbox','Next','In Progress','Waiting','Scheduled','Someday','Complete','Cancelled')) or
 (kind='reminder' and status in ('Active','Snoozed','Complete','Dismissed')) or
 (kind in ('project','initiative') and status in ('Active','On Hold','Complete')) or
 (kind='person' and status='Active') or (kind='journal' and status='Recorded') or (kind='waiting' and status in ('Active','Complete')));
alter table public.work_items
 add column project_id uuid,
 add column initiative_id uuid,
 add column person_id uuid,
 add column task_id uuid,
 add column source_entry_id uuid,
 add column entry_type text not null default 'Thought' check(entry_type in ('Capture','Thought','Idea','Research','Decision','Meeting','Learning','Experiment','Observation','Progress','Problem','Opportunity')),
 add column tags text[] not null default '{}' check(cardinality(tags)<=20 and length(array_to_string(tags,','))<=2000),
 add column goals text not null default '' check(length(goals)<=10000),
 add column current_state text not null default '' check(length(current_state)<=10000),
 add column next_milestone text not null default '' check(length(next_milestone)<=10000),
 add column organization text not null default '' check(length(organization)<=240),
 add column person_role text not null default '' check(length(person_role)<=240),
 add column search_vector tsvector generated always as (to_tsvector('english',title||' '||body||' '||original_body)) stored,
 add foreign key(user_id,project_id) references public.work_items(user_id,id),
 add foreign key(user_id,initiative_id) references public.work_items(user_id,id),
 add foreign key(user_id,person_id) references public.work_items(user_id,id),
 add foreign key(user_id,task_id) references public.work_items(user_id,id),
 add foreign key(user_id,source_entry_id) references public.work_items(user_id,id);
create index work_search on public.work_items using gin(search_vector);
create index work_project on public.work_items(user_id,project_id) where project_id is not null;
create index work_initiative on public.work_items(user_id,initiative_id) where initiative_id is not null;
create index work_person on public.work_items(user_id,person_id) where person_id is not null;
create index work_task on public.work_items(user_id,task_id) where task_id is not null;
create index work_source on public.work_items(user_id,source_entry_id) where source_entry_id is not null;
create function private.guard_context() returns trigger language plpgsql set search_path='' as $$
declare link_id uuid; expected_kind text;
begin
 for link_id,expected_kind in select * from (values(new.project_id,'project'),(new.initiative_id,'initiative'),(new.person_id,'person'),(new.task_id,'task'),(new.source_entry_id,'journal')) as links(id,kind) loop
  if link_id is not null and (link_id=new.id or not exists(select 1 from public.work_items where id=link_id and user_id=new.user_id and kind=expected_kind)) then raise exception 'Invalid context link' using errcode='23514'; end if;
 end loop;
 return new;
end $$;
create trigger work_context before insert or update on public.work_items for each row execute function private.guard_context();
revoke all on function private.guard_context() from public,anon,authenticated;

create table public.journal_revisions (
 id uuid primary key default gen_random_uuid(), item_id uuid not null,
 user_id uuid not null, version integer not null, snapshot jsonb not null,
 created_at timestamptz not null default now(), unique(item_id,version),
 foreign key(user_id,item_id) references public.work_items(user_id,id)
);
alter table public.journal_revisions enable row level security;
revoke all on public.journal_revisions from public,anon,authenticated;
grant select on public.journal_revisions to authenticated;
grant all on public.journal_revisions to service_role;
create index revision_owner_item on public.journal_revisions(user_id,item_id,version desc);
create policy revision_owner on public.journal_revisions for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create function private.preserve_journal_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'work_items' then raise exception 'Invalid revision context'; end if;
 if new.kind='journal' then insert into public.journal_revisions(item_id,user_id,version,snapshot) values(new.id,new.user_id,new.version,to_jsonb(new)-'search_vector');end if;
 return new;
end $$;
create trigger journal_history after insert or update on public.work_items for each row execute function private.preserve_journal_revision();
revoke all on function private.preserve_journal_revision() from public,anon,authenticated;

create or replace function public.convert_reminder(reminder_id uuid, expected_version integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.work_items; target uuid;
begin
 select * into r from public.work_items where id=reminder_id and kind='reminder' for update;
 if not found then raise exception 'Reminder unavailable' using errcode='42501'; end if;
 if r.converted_task_id is not null then return r.converted_task_id; end if;
 if r.version<>expected_version or r.archived or r.status not in ('Active','Snoozed') then raise exception 'Reload this reminder before converting' using errcode='40001'; end if;
 insert into public.work_items(user_id,kind,title,body,status,priority,due_date,project_id,person_id,initiative_id,source_entry_id,tags)
 values(r.user_id,'task',r.title,r.body,'Inbox',r.priority,coalesce(r.due_date,(r.remind_at at time zone 'America/New_York')::date),r.project_id,r.person_id,r.initiative_id,r.source_entry_id,r.tags) returning id into target;
 update public.work_items set converted_task_id=target,status='Complete',snoozed_until=null where id=r.id;
 return target;
end $$;
