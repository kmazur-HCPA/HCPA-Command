alter table public.work_items drop constraint work_kind;
alter table public.work_items add constraint work_kind check(kind in ('task','reminder','project','initiative','person','journal','waiting','learning','program','use_case','experiment','library'));
alter table public.work_items drop constraint work_status;
alter table public.work_items add constraint work_status check(
 (kind='task' and status in ('Inbox','Next','In Progress','Waiting','Scheduled','Someday','Complete','Cancelled')) or
 (kind='reminder' and status in ('Active','Snoozed','Complete','Dismissed')) or
 (kind in ('project','initiative') and status in ('Active','On Hold','Complete')) or
 (kind='person' and status='Active') or (kind='journal' and status='Recorded') or (kind='waiting' and status in ('Active','Complete')) or
 (kind='learning' and status in ('Saved','Planned','In Progress','Complete','Abandoned')) or
 (kind='program' and status in ('Active','On Hold','Complete')) or
 (kind='use_case' and status in ('Idea','Researching','Proposed','Approved','Pilot','Production','Rejected','Retired')) or
 (kind='experiment' and status in ('Planned','In Progress','Complete','Abandoned')) or
 (kind='library' and status='Recorded'));
alter table public.work_items add column details jsonb not null default '{}' check(jsonb_typeof(details)='object' and octet_length(details::text)<=80000);
alter table public.work_items add column learning_id uuid, add foreign key(user_id,learning_id) references public.work_items(user_id,id);
create index work_learning_id on public.work_items(user_id,learning_id) where learning_id is not null;
alter table public.work_items add column program_id uuid, add foreign key(user_id,program_id) references public.work_items(user_id,id);
create index work_program_id on public.work_items(user_id,program_id) where program_id is not null;
alter table public.work_items add column use_case_id uuid, add foreign key(user_id,use_case_id) references public.work_items(user_id,id);
create index work_use_case_id on public.work_items(user_id,use_case_id) where use_case_id is not null;
alter table public.work_items add column experiment_id uuid, add foreign key(user_id,experiment_id) references public.work_items(user_id,id);
create index work_experiment_id on public.work_items(user_id,experiment_id) where experiment_id is not null;
alter table public.work_items add column decision_id uuid, add foreign key(user_id,decision_id) references public.work_items(user_id,id);
create index work_decision_id on public.work_items(user_id,decision_id) where decision_id is not null;
create function private.guard_lab() returns trigger language plpgsql set search_path='' as $$
declare link_id uuid; expected_kind text; k text; v jsonb; allowed text[];
begin
 for link_id,expected_kind in select * from (values (new.learning_id,'learning'),(new.program_id,'program'),(new.use_case_id,'use_case'),(new.experiment_id,'experiment'),(new.decision_id,'journal')) as links(id,kind) loop
 if link_id is not null and (link_id=new.id or not exists(select 1 from public.work_items where id=link_id and user_id=new.user_id and kind=expected_kind and (expected_kind<>'journal' or entry_type='Decision'))) then raise exception 'Invalid learning or lab link' using errcode='23514'; end if;
 end loop;
 if new.kind='journal' and new.entry_type<>'Decision' and exists(select 1 from public.work_items where user_id=new.user_id and decision_id=new.id) then raise exception 'This entry is referenced as a decision; retain its Decision type'; end if;
 allowed := case new.kind
 when 'learning' then array['provider','type','url','start_date','completion_date','progress','topic','takeaways','usefulness','applicability']
 when 'program' then array['definition','objectives','milestones','roadmap','current_state','accomplishments','risks','next_work','governance','platforms','data_handling','human_review']
 when 'use_case' then array['problem','proposed_use','department','owner','data_involved','risk','expected_benefit','actual_benefit','requirements','decision']
 when 'experiment' then array['question','hypothesis','tool','model','setup','inputs','results','problems','conclusion','next_action']
 when 'library' then array['category','classification','source','author','url','document_date']
 else array[]::text[] end;
 for k,v in select * from jsonb_each(new.details) loop
 if not(k=any(allowed)) or jsonb_typeof(v)<>'string' or length(v#>>'{}')>10000 then raise exception 'Invalid detail field' using errcode='23514'; end if;
 end loop;
 if new.kind='learning' and coalesce(new.details->>'type','')<>'' and not(new.details->>'type'=any(array['Course','Article','Paper','Video','Webinar','Conference','Podcast','Book','Documentation','Tutorial','Other'])) then raise exception 'Invalid field choice' using errcode='23514'; end if;
 if new.kind='learning' and coalesce(new.details->>'usefulness','')<>'' and not(new.details->>'usefulness'=any(array['Not assessed','Low','Moderate','High'])) then raise exception 'Invalid field choice' using errcode='23514'; end if;
 if new.kind='use_case' and coalesce(new.details->>'risk','')<>'' and not(new.details->>'risk'=any(array['Not assessed','Low','Moderate','High'])) then raise exception 'Invalid field choice' using errcode='23514'; end if;
 if new.kind='library' and coalesce(new.details->>'category','')<>'' and not(new.details->>'category'=any(array['HCPA','AI Governance','Research','Learning','Command'])) then raise exception 'Invalid field choice' using errcode='23514'; end if;
 if new.kind='library' and coalesce(new.details->>'classification','')<>'' and not(new.details->>'classification'=any(array['Public','Internal'])) then raise exception 'Invalid field choice' using errcode='23514'; end if;
 if coalesce(new.details->>'progress','')<>'' then
 if (new.details->>'progress')!~'^[0-9]{1,3}$' then raise exception 'Progress must be 0 to 100'; end if;
 if (new.details->>'progress')::integer>100 then raise exception 'Progress must be 0 to 100'; end if;
 end if;
 if coalesce(new.details->>'url','')<>'' and (new.details->>'url')!~'^https?://' then raise exception 'Source URL must use HTTP or HTTPS'; end if;
 if new.kind='use_case' and new.status in ('Approved','Pilot','Production','Rejected','Retired') and btrim(coalesce(new.details->>'decision',''))='' then raise exception 'Record a decision and rationale for this status'; end if;
 return new;
end $$;
create trigger work_lab before insert or update on public.work_items for each row execute function private.guard_lab();
revoke all on function private.guard_lab() from public,anon,authenticated;
create or replace function private.preserve_journal_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'work_items' then raise exception 'Invalid revision context'; end if;
 if new.kind in ('journal','learning','program','use_case','experiment','library') then insert into public.journal_revisions(item_id,user_id,version,snapshot) values(new.id,new.user_id,new.version,to_jsonb(new)-'search_vector'); end if;
 return new;
end $$;
