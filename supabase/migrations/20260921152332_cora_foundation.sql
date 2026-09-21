-- Conversation writes and quota reservations belong to the authenticated server,
-- never the model or browser. Command record tools continue to use the caller's RLS.
create table public.cora_conversations (
 id uuid primary key, user_id uuid not null references auth.users(id),
 title text not null check(length(title) between 1 and 120),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id)
);
create table public.cora_turns (
 id uuid primary key, user_id uuid not null references auth.users(id),
 conversation_id uuid not null, message text not null check(length(message) between 1 and 4000),
 context jsonb not null default '{}', response text not null default '' check(length(response)<=20000),
 sources jsonb not null default '[]', proposal jsonb, task_id uuid not null default gen_random_uuid(),
 status text not null default 'running' check(status in ('running','complete','error')),
 action_status text not null default 'none' check(action_status in ('none','proposed','created')),
 created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(conversation_id,user_id) references public.cora_conversations(id,user_id),
 unique(id,user_id)
);
create table public.cora_activity (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 turn_id uuid not null, tool text not null, arguments jsonb not null default '{}',
 result jsonb not null default '{}', success boolean not null, created_at timestamptz not null default now(),
 foreign key(turn_id,user_id) references public.cora_turns(id,user_id)
);
create index cora_conversation_owner_time on public.cora_conversations(user_id,updated_at desc,id);
create index cora_turn_owner_time on public.cora_turns(user_id,created_at desc,id);
create index cora_turn_conversation_time on public.cora_turns(conversation_id,user_id,created_at,id);
create index cora_activity_turn on public.cora_activity(turn_id,user_id,created_at,id);
alter table public.cora_conversations enable row level security;
alter table public.cora_turns enable row level security;
alter table public.cora_activity enable row level security;
revoke all on public.cora_conversations,public.cora_turns,public.cora_activity from anon,authenticated;
grant select on public.cora_conversations,public.cora_turns,public.cora_activity to authenticated;
grant all on public.cora_conversations,public.cora_turns,public.cora_activity to service_role;
create policy cora_conversation_owner on public.cora_conversations for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy cora_turn_owner on public.cora_turns for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy cora_activity_owner on public.cora_activity for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

-- Serialized per-user reservation prevents concurrent runs and retry duplicates.
-- Invoker rights, executable only by the server role; no public privileged function.
create function public.cora_begin(p_user uuid,p_conversation uuid,p_request uuid,p_message text,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.cora_turns;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not exists(select 1 from public.app_memberships where user_id=p_user and active) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into existing from public.cora_turns where id=p_request;
 if found then
  if existing.user_id<>p_user or existing.conversation_id<>p_conversation or existing.message<>p_message or existing.context<>p_context then raise exception 'Request conflict' using errcode='22023'; end if;
  return jsonb_build_object('turn',to_jsonb(existing),'started',false);
 end if;
 if (select count(*) from public.cora_turns where user_id=p_user and created_at>now()-interval '1 minute')>=12 or
    (select count(*) from public.cora_turns where user_id=p_user and created_at>now()-interval '24 hours')>=100 then raise exception 'Cora request limit reached' using errcode='P0001'; end if;
 if exists(select 1 from public.cora_turns where user_id=p_user and status='running' and created_at>now()-interval '1 minute') then raise exception 'Cora is already working' using errcode='P0001'; end if;
 insert into public.cora_conversations(id,user_id,title) values(p_conversation,p_user,left(p_message,120)) on conflict(id) do nothing;
 if not exists(select 1 from public.cora_conversations where id=p_conversation and user_id=p_user) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 insert into public.cora_turns(id,user_id,conversation_id,message,context) values(p_request,p_user,p_conversation,p_message,p_context) returning * into existing;
 update public.cora_conversations set updated_at=now() where id=p_conversation;
 return jsonb_build_object('turn',to_jsonb(existing),'started',true);
end $$;
revoke all on function public.cora_begin(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cora_begin(uuid,uuid,uuid,text,jsonb) to service_role;

-- Preserve portability as the application grows. Existing format remains additive.
alter function public.export_workspace() rename to export_core_workspace;
create function public.export_workspace() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.export_core_workspace()||jsonb_build_object(
 'cora_conversations',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.cora_conversations c),'[]'::jsonb),
 'cora_turns',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.cora_turns t),'[]'::jsonb),
 'cora_activity',coalesce((select jsonb_agg(to_jsonb(a) order by id) from public.cora_activity a),'[]'::jsonb));
 result:=jsonb_set(result,'{counts}',result->'counts'||jsonb_build_object('cora_conversations',(select count(*) from public.cora_conversations),'cora_turns',(select count(*) from public.cora_turns),'cora_activity',(select count(*) from public.cora_activity)));
 if octet_length(result::text)>52428800 then raise exception 'Workspace exceeds browser export size'; end if;
 return result;
end $$;
revoke all on function public.export_workspace() from public,anon;
grant execute on function public.export_workspace() to authenticated;
