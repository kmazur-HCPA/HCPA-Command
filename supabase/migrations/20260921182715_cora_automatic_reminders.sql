-- Explicit per-owner consent, not inferred from membership or Microsoft access.
create table public.cora_review_preferences (
 user_id uuid primary key references public.app_memberships(user_id),
 automatic_reminders boolean not null default false
);
create table public.cora_reminder_sources (
 user_id uuid not null references public.app_memberships(user_id),
 source_hash text not null check(length(source_hash)=64),
 reminder_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(user_id,source_hash),
 foreign key(user_id,reminder_id) references public.work_items(user_id,id)
);
create table public.cora_workday_reviews (
 id uuid primary key, user_id uuid not null references public.app_memberships(user_id),
 status text not null check(status in ('running','complete','partial','failed')),
 summary text not null default '' check(length(summary)<=6000),
 started_at timestamptz not null default now(), finished_at timestamptz
);
create index cora_reviews_owner_time on public.cora_workday_reviews(user_id,started_at desc);
create index cora_sources_reminder on public.cora_reminder_sources(user_id,reminder_id);
alter table public.cora_review_preferences enable row level security;
alter table public.cora_reminder_sources enable row level security;
alter table public.cora_workday_reviews enable row level security;
revoke all on public.cora_review_preferences,public.cora_reminder_sources,public.cora_workday_reviews from public,anon,authenticated;
grant select on public.cora_review_preferences,public.cora_reminder_sources,public.cora_workday_reviews to authenticated;
grant update(automatic_reminders) on public.cora_review_preferences to authenticated;
grant all on public.cora_review_preferences,public.cora_reminder_sources,public.cora_workday_reviews to service_role;
create policy cora_review_preference_owner on public.cora_review_preferences for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy cora_reminder_source_owner on public.cora_reminder_sources for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create policy cora_review_owner on public.cora_workday_reviews for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));

-- Serialized per owner. An already handled source never recreates dismissed/completed work.
-- Server-only callers supply verified owner IDs; browsers cannot invoke this function.
create function public.cora_create_reminder(p_user uuid,p_source_hash text,p_title text,p_body text,p_due date,p_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare target uuid; enabled boolean;
begin
 select automatic_reminders into enabled from public.cora_review_preferences where user_id=p_user for update;
 if not found or not enabled then raise exception 'Automatic reminders are disabled' using errcode='42501'; end if;
 perform 1 from public.app_memberships where user_id=p_user and active for share;
 if not found then raise exception 'Access unavailable' using errcode='42501'; end if;
 if p_source_hash is null or length(p_source_hash)<>64 or p_title is null or length(btrim(p_title)) not between 1 and 200 or p_body is null or length(p_body)>6000 or (p_due is not null and p_at is not null) then raise exception 'Invalid reminder'; end if;
 select reminder_id into target from public.cora_reminder_sources where user_id=p_user and source_hash=p_source_hash;
 if found then return jsonb_build_object('id',target,'created',false,'saved',true); end if;
 -- Also reconcile identical manually entered reminders and alternate sources.
 select id into target from public.work_items where user_id=p_user and kind='reminder'
 and lower(regexp_replace(btrim(title),'\s+',' ','g'))=lower(regexp_replace(btrim(p_title),'\s+',' ','g'))
 and due_date is not distinct from p_due and remind_at is not distinct from p_at order by created_at limit 1;
 if found then
   insert into public.cora_reminder_sources(user_id,source_hash,reminder_id) values(p_user,p_source_hash,target);
   return jsonb_build_object('id',target,'created',false,'saved',true);
 end if;
 if (select count(*) from public.cora_reminder_sources where user_id=p_user and created_at>now()-interval '24 hours')>=40 then raise exception 'Daily automatic reminder limit reached'; end if;
 insert into public.work_items(user_id,kind,title,body,status,priority,due_date,remind_at)
 values(p_user,'reminder',btrim(p_title),p_body,'Active','Normal',p_due,p_at) returning id into target;
 insert into public.cora_reminder_sources(user_id,source_hash,reminder_id) values(p_user,p_source_hash,target);
 return jsonb_build_object('id',target,'created',true,'saved',true);
end $$;
revoke all on function public.cora_create_reminder(uuid,text,text,text,date,timestamptz) from public,anon,authenticated;
grant execute on function public.cora_create_reminder(uuid,text,text,text,date,timestamptz) to service_role;

alter function public.export_workspace() rename to export_pre_review_workspace;
create function public.export_workspace() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; extra jsonb;
begin
 result:=public.export_pre_review_workspace();
 extra:=jsonb_build_object(
 'cora_review_preferences',coalesce((select jsonb_agg(to_jsonb(t) order by user_id) from public.cora_review_preferences t),'[]'::jsonb),
 'cora_reminder_sources',coalesce((select jsonb_agg(to_jsonb(t) order by source_hash) from public.cora_reminder_sources t),'[]'::jsonb),
 'cora_workday_reviews',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.cora_workday_reviews t),'[]'::jsonb));
 result:=result||extra;
 result:=jsonb_set(result,'{counts}',result->'counts'||jsonb_build_object('cora_review_preferences',jsonb_array_length(extra->'cora_review_preferences'),'cora_reminder_sources',jsonb_array_length(extra->'cora_reminder_sources'),'cora_workday_reviews',jsonb_array_length(extra->'cora_workday_reviews')));
 if octet_length(result::text)>52428800 then raise exception 'Workspace exceeds browser export size'; end if;
 return result;
end $$;
revoke all on function public.export_workspace() from public,anon;
grant execute on function public.export_workspace() to authenticated;
