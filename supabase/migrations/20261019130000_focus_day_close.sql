-- Command Focus 1.4, 1.7, 1.8: Close the Day, habit metrics, read-only brief history.
--
-- ROLLBACK (manual):
--   drop function public.apply_day_close(uuid,date,jsonb,uuid,boolean,text,jsonb,jsonb);
--   drop table public.day_closes, public.usage_events;   -- receipts only; no work records
--   restore capture_flagged_email from 20261001120000_flagged_mail_sitrep.sql and the
--     email_captures action check without 'waiting';
--   grant insert,update,delete on public.cora_workday_reviews to service_role;

-- Retire Command Brief: the table stays readable (retention) but nothing can write it.
revoke insert,update,delete on public.cora_workday_reviews from authenticated,service_role;

-- A flagged message can also become a Waiting On item.
alter table public.email_captures drop constraint email_captures_action_check;
alter table public.email_captures add constraint email_captures_action_check check(action in ('task','reminder','waiting','dismissed'));

-- Core of capture_flagged_email, callable for an explicit owner so a batch can use it.
create function public.capture_flagged_email_as(
 p_user uuid,p_message_id text,p_conversation_id text,p_action text,
 p_title text,p_due date,p_priority text,p_source_url text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.email_captures; target uuid;
begin
 if p_user is null or (auth.uid() is not null and auth.uid()<>p_user)
  or not exists(select 1 from public.app_memberships where user_id=p_user and active) then raise exception 'Access unavailable' using errcode='42501'; end if;
 if p_action not in ('task','reminder','waiting','dismissed') then raise exception 'Invalid capture action'; end if;
 if p_action<>'dismissed' then
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then raise exception 'Add a title'; end if;
  if p_action='reminder' and p_due is null then raise exception 'Choose a date for the reminder'; end if;
  if p_priority not in ('Critical','High','Normal','Low') then raise exception 'Invalid priority'; end if;
 end if;
 select * into existing from public.email_captures where user_id=p_user and message_id=p_message_id;
 -- A dismissed message may still be converted later; any other capture is final.
 if found and existing.action='dismissed' and p_action<>'dismissed' then
  delete from public.email_captures where user_id=p_user and message_id=p_message_id;
  existing:=null;
 end if;
 if existing.message_id is not null then
  return jsonb_build_object('captured',true,'created',false,'action',existing.action,'record_id',existing.record_id);
 end if;
 begin
  if p_action='dismissed' then
   insert into public.email_captures(user_id,message_id,conversation_id,action) values(p_user,p_message_id,p_conversation_id,'dismissed');
   return jsonb_build_object('captured',true,'created',true,'action','dismissed','record_id',null);
  end if;
  insert into public.work_items(user_id,kind,title,body,status,priority,due_date)
  values(p_user,p_action,btrim(p_title),
   case when p_source_url is null then '' else 'Source: '||p_source_url end,
   case when p_action='task' then 'Inbox' else 'Active' end,p_priority,p_due) returning id into target;
  insert into public.email_captures(user_id,message_id,conversation_id,action,record_id) values(p_user,p_message_id,p_conversation_id,p_action,target);
  return jsonb_build_object('captured',true,'created',true,'action',p_action,'record_id',target);
 exception when unique_violation then
  select * into existing from public.email_captures where user_id=p_user and message_id=p_message_id;
  return jsonb_build_object('captured',true,'created',false,'action',existing.action,'record_id',existing.record_id);
 end;
end $$;
revoke all on function public.capture_flagged_email_as(uuid,text,text,text,text,date,text,text) from public,anon;
grant execute on function public.capture_flagged_email_as(uuid,text,text,text,text,date,text,text) to authenticated,service_role;
-- The browser entry point keeps its signature and uses the signed-in user.
create or replace function public.capture_flagged_email(
 p_message_id text,p_conversation_id text,p_action text,
 p_title text,p_due date,p_priority text,p_source_url text
) returns jsonb language sql security invoker set search_path='' as $$
 select public.capture_flagged_email_as((select auth.uid()),p_message_id,p_conversation_id,p_action,p_title,p_due,p_priority,p_source_url)
$$;

create table public.day_closes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_memberships(user_id),
 for_date date not null,
 completed_at timestamptz not null default now(),
 counts jsonb not null default '{}'::jsonb check(jsonb_typeof(counts)='object'),
 first_item_id uuid,
 foreign key(user_id,first_item_id) references public.work_items(user_id,id)
);
create index day_closes_owner_time on public.day_closes(user_id,completed_at desc);
create table public.usage_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_memberships(user_id),
 event text not null check(event in ('app_open','capture','day_close','sitrep_opened')),
 source text not null check(source in ('web','chat','shortcut','push')),
 created_at timestamptz not null default now()
);
create index usage_events_owner_time on public.usage_events(user_id,created_at desc);
alter table public.day_closes enable row level security;
alter table public.usage_events enable row level security;
revoke all on public.day_closes,public.usage_events from public,anon,authenticated;
grant select,insert on public.day_closes,public.usage_events to authenticated;
grant all on public.day_closes,public.usage_events to service_role;
create policy day_closes_owner_read on public.day_closes for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy day_closes_owner_write on public.day_closes for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy usage_events_owner_read on public.usage_events for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy usage_events_owner_write on public.usage_events for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

-- One transaction applies explicit actions, converts flagged mail, sets tomorrow's
-- first item and (when finishing) writes the receipt. Any stale version, unknown
-- record or invalid action raises, so nothing is half applied.
--   p_actions: [{"id":uuid,"version":int,"op":"done"|"date"|"drop","date":"YYYY-MM-DD"}]
--   p_mail:    [{"message_id","conversation_id","action":"task|reminder|waiting|dismissed","title","due","priority","url"}]
--   p_counts:  counts already applied earlier in this close (the browser applies taps one by one).
create function public.apply_day_close(
 p_user uuid,p_for_date date,p_actions jsonb,p_first uuid,p_finish boolean,
 p_source text default 'web',p_mail jsonb default '[]'::jsonb,p_counts jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb; r public.work_items; res jsonb; new_date date; first_row public.work_items;
 n_done int:=0; n_rolled int:=0; n_dropped int:=0; n_converted int:=0; totals jsonb; receipt uuid; tz constant text:='America/New_York';
begin
 if p_user is null or (auth.uid() is not null and auth.uid()<>p_user) then raise exception 'Access unavailable' using errcode='42501'; end if;
 perform 1 from public.app_memberships where user_id=p_user and active;
 if not found then raise exception 'Access unavailable' using errcode='42501'; end if;
 if p_for_date is null or p_source not in ('web','chat','shortcut','push') then raise exception 'Invalid request'; end if;
 if jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions)>100 or jsonb_typeof(p_mail)<>'array' or jsonb_array_length(p_mail)>50
  or jsonb_typeof(p_counts)<>'object' then raise exception 'Invalid request'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_actions) x)<>jsonb_array_length(p_actions) then raise exception 'Each record may appear once'; end if;
 -- Verify everything first, locking the rows.
 for a in select * from jsonb_array_elements(p_actions) loop
  if a->>'op' not in ('done','date','drop') or (a->>'op'='date' and (a->>'date') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid action'; end if;
  select * into r from public.work_items where id=(a->>'id')::uuid and user_id=p_user for update;
  if not found or r.archived or r.kind not in ('task','reminder','waiting') then raise exception 'Record unavailable: %',a->>'id' using errcode='P0002'; end if;
  if r.version<>(a->>'version')::int then raise exception 'Record changed since it was read: %',r.title using errcode='40001'; end if;
  if r.status in ('Complete','Cancelled','Dismissed') then raise exception 'Record is already closed: %',r.title using errcode='40001'; end if;
 end loop;
 for a in select * from jsonb_array_elements(p_actions) loop
  select * into r from public.work_items where id=(a->>'id')::uuid and user_id=p_user;
  if a->>'op'='done' then
   update public.work_items set status='Complete' where id=r.id; n_done:=n_done+1;
  elsif a->>'op'='drop' then
   update public.work_items set archived=true where id=r.id; n_dropped:=n_dropped+1;
  else
   new_date:=(a->>'date')::date;
   if r.kind='reminder' and r.remind_at is not null then
    update public.work_items set status='Active',snoozed_until=null,
     remind_at=((new_date::timestamp+((r.remind_at at time zone tz)::time)) at time zone tz) where id=r.id;
   elsif r.kind='reminder' then
    update public.work_items set status='Active',snoozed_until=null,due_date=new_date where id=r.id;
   else
    update public.work_items set due_date=new_date where id=r.id;
   end if;
   n_rolled:=n_rolled+1;
  end if;
 end loop;
 for a in select * from jsonb_array_elements(p_mail) loop
  res:=public.capture_flagged_email_as(p_user,a->>'message_id',nullif(a->>'conversation_id',''),a->>'action',a->>'title',
   nullif(a->>'due','')::date,coalesce(nullif(a->>'priority',''),'Normal'),nullif(a->>'url',''));
  if (res->>'created')::boolean then
   if a->>'action'='dismissed' then n_dropped:=n_dropped+1; else n_converted:=n_converted+1; end if;
  end if;
 end loop;
 if p_first is not null then
  select * into first_row from public.work_items
   where id=p_first and user_id=p_user and kind='task' and not archived and status not in ('Complete','Cancelled') for update;
  if not found then raise exception 'Tomorrow''s first item must be an open task'; end if;
  update public.work_items set focus_slot=null
   where user_id=p_user and focus_slot=1 and id<>p_first and not archived and status not in ('Complete','Cancelled');
  update public.work_items set focus_slot=1 where id=p_first and focus_slot is distinct from 1;
 end if;
 totals:=jsonb_build_object(
  'done',n_done+coalesce((p_counts->>'done')::int,0),
  'rolled',n_rolled+coalesce((p_counts->>'rolled')::int,0),
  'dropped',n_dropped+coalesce((p_counts->>'dropped')::int,0),
  'converted',n_converted+coalesce((p_counts->>'converted')::int,0));
 if (select min(v::int) from jsonb_each_text(totals) t(k,v))<0 or (select max(v::int) from jsonb_each_text(totals) t(k,v))>1000 then raise exception 'Invalid counts'; end if;
 if p_finish then
  insert into public.day_closes(user_id,for_date,counts,first_item_id) values(p_user,p_for_date,totals,p_first) returning id into receipt;
  insert into public.usage_events(user_id,event,source) values(p_user,'day_close',p_source);
 end if;
 return jsonb_build_object('applied',jsonb_build_object('done',n_done,'rolled',n_rolled,'dropped',n_dropped,'converted',n_converted),'counts',totals,'receipt_id',receipt);
end $$;
revoke all on function public.apply_day_close(uuid,date,jsonb,uuid,boolean,text,jsonb,jsonb) from public,anon;
grant execute on function public.apply_day_close(uuid,date,jsonb,uuid,boolean,text,jsonb,jsonb) to authenticated,service_role;
