-- Command Focus 1.2: initiatives and programs become Proposed projects.
-- Nothing is deleted. Each original row is archived and keeps its ID, with
-- details.migrated_to pointing at the new project; the project's
-- details.migrated_from records the original kind and ID (a string such as
-- 'initiative:<uuid>', joined with ';' when two records were merged).
--
-- ROLLBACK (manual, in this order):
--   1. update public.work_items set archived=false, details=details-'migrated_to' where details ? 'migrated_to';
--   2. update public.work_items set archived=true where kind='project' and details ? 'migrated_from';
--      (archive, do not delete, the projects this migration created)
--   3. restore the previous work_status check (the same list without 'Proposed' for projects).

alter table public.work_items drop constraint work_status;
alter table public.work_items add constraint work_status check (
 ((kind = 'task') and status = any (array['Inbox','Next','In Progress','Waiting','Scheduled','Someday','Complete','Cancelled'])) or
 ((kind = 'reminder') and status = any (array['Active','Snoozed','Complete','Dismissed'])) or
 ((kind = 'project') and status = any (array['Active','On Hold','Proposed','Complete'])) or
 ((kind = 'initiative') and status = any (array['Active','On Hold','Complete'])) or
 ((kind = 'person') and status = 'Active') or
 ((kind = 'journal') and status = 'Recorded') or
 ((kind = 'waiting') and status = any (array['Active','Complete'])) or
 ((kind = 'learning') and status = any (array['Saved','Planned','In Progress','Complete','Abandoned'])) or
 ((kind = 'program') and status = any (array['Active','On Hold','Complete'])) or
 ((kind = 'use_case') and status = any (array['Idea','Researching','Proposed','Approved','Pilot','Production','Rejected','Retired'])) or
 ((kind = 'experiment') and status = any (array['Planned','In Progress','Complete','Abandoned'])) or
 ((kind = 'library') and status = 'Recorded')
);

-- Projects keep a program's detail fields when it is folded in, plus the migration
-- markers. Initiatives and programs may gain migrated_to when archived.
create or replace function private.guard_lab() returns trigger language plpgsql set search_path='' as $$
declare link_id uuid; expected_kind text; k text; v jsonb; allowed text[];
begin
 for link_id,expected_kind in select * from (values (new.learning_id,'learning'),(new.program_id,'program'),(new.use_case_id,'use_case'),(new.experiment_id,'experiment'),(new.decision_id,'journal')) as links(id,kind) loop
 if link_id is not null and (link_id=new.id or not exists(select 1 from public.work_items where id=link_id and user_id=new.user_id and kind=expected_kind and (expected_kind<>'journal' or entry_type='Decision'))) then raise exception 'Invalid learning or lab link' using errcode='23514'; end if;
 end loop;
 if new.kind='journal' and new.entry_type<>'Decision' and exists(select 1 from public.work_items where user_id=new.user_id and decision_id=new.id) then raise exception 'This entry is referenced as a decision; retain its Decision type'; end if;
 allowed := case new.kind
 when 'person' then array['email','phone','mobile','department','location']
 when 'project' then array['definition','objectives','milestones','roadmap','current_state','accomplishments','risks','next_work','governance','platforms','data_handling','human_review','migrated_from','migrated_to']
 when 'initiative' then array['migrated_to']
 when 'learning' then array['provider','type','url','start_date','completion_date','progress','topic','takeaways','usefulness','applicability']
 when 'program' then array['definition','objectives','milestones','roadmap','current_state','accomplishments','risks','next_work','governance','platforms','data_handling','human_review','migrated_to']
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
 if new.kind='person' then
   if length(coalesce(new.details->>'email',''))>254 or (coalesce(new.details->>'email','')<>'' and (new.details->>'email') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$') then raise exception 'Invalid contact email'; end if;
   if length(coalesce(new.details->>'phone',''))>80 or length(coalesce(new.details->>'mobile',''))>80 or coalesce(new.details->>'phone','') ~ '[[:cntrl:]]' or coalesce(new.details->>'mobile','') ~ '[[:cntrl:]]' then raise exception 'Invalid contact phone'; end if;
   if length(coalesce(new.details->>'department',''))>240 or length(coalesce(new.details->>'location',''))>240 then raise exception 'Contact field too long'; end if;
 end if;
 return new;
end $$;

-- Creates one Proposed project from an initiative or program (and, optionally,
-- a second record folded into it) and archives the originals.
create function public.focus_new_project(p_src public.work_items,p_fold public.work_items) returns uuid
language plpgsql security invoker set search_path='' as $$
declare new_id uuid; new_body text; new_goals text; definition text; origin text;
begin
 definition:=coalesce(p_src.details->>'definition','');
 new_goals:=coalesce(nullif(p_src.goals,''),definition,'');
 new_body:=p_src.body;
 if definition<>'' and p_src.goals<>'' then new_body:=new_body||E'\n\nDefinition: '||definition; end if;
 origin:=p_src.kind||':'||p_src.id;
 if p_fold.id is not null then
  new_body:=new_body||E'\n\nMerged from '||p_fold.kind||' "'||p_fold.title||'"'||case when p_fold.body<>'' then E':\n'||p_fold.body else '' end;
  if p_src.goals='' and p_fold.goals<>'' then new_goals:=p_fold.goals; end if;
  origin:=origin||';'||p_fold.kind||':'||p_fold.id;
 end if;
 insert into public.work_items(user_id,kind,title,body,status,priority,due_date,tags,goals,current_state,next_milestone,organization,person_role,person_id,details)
 values(p_src.user_id,'project',p_src.title,left(new_body,50000),'Proposed',p_src.priority,p_src.due_date,p_src.tags,left(new_goals,10000),
  coalesce(nullif(p_src.current_state,''),p_fold.current_state,''),coalesce(nullif(p_src.next_milestone,''),p_fold.next_milestone,''),
  p_src.organization,p_src.person_role,p_src.person_id,p_src.details||jsonb_build_object('migrated_from',origin))
 returning id into new_id;
 update public.work_items set archived=true,details=details||jsonb_build_object('migrated_to',new_id::text) where id in (p_src.id,p_fold.id);
 -- Re-point links only where the linked record has no project yet.
 update public.work_items set project_id=new_id
  where user_id=p_src.user_id and project_id is null and id<>new_id
  and (initiative_id in (p_src.id,p_fold.id) or program_id in (p_src.id,p_fold.id));
 return new_id;
end $$;

-- p_merges: [{"keep_title":"...","fold_title":"..."}]. The kept record's project
-- absorbs the folded record. Safe to run again: archived rows are skipped.
create function public.focus_fold_to_projects(p_merges jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.work_items; f public.work_items; blank public.work_items; m jsonb; converted int:=0; merged int:=0;
begin
 for m in select * from jsonb_array_elements(p_merges) loop
  for r in select * from public.work_items where kind in ('initiative','program') and not archived and title=m->>'keep_title' loop
   select * into f from public.work_items where kind in ('initiative','program') and not archived and user_id=r.user_id and id<>r.id and title=m->>'fold_title';
   if found then
    perform public.focus_new_project(r,f); converted:=converted+2; merged:=merged+1;
   end if;
  end loop;
 end loop;
 for r in select * from public.work_items where kind in ('initiative','program') and not archived order by created_at,id loop
  perform public.focus_new_project(r,blank); converted:=converted+1;
 end loop;
 return jsonb_build_object('converted',converted,'merged_pairs',merged);
end $$;
revoke all on function public.focus_new_project(public.work_items,public.work_items),public.focus_fold_to_projects(jsonb) from public,anon,authenticated;
grant execute on function public.focus_new_project(public.work_items,public.work_items),public.focus_fold_to_projects(jsonb) to service_role;

select public.focus_fold_to_projects('[{"keep_title":"Automated Variance Map Intake, Generation and Distribution","fold_title":"Create a GIS AI Agent to do Variance Maps"}]'::jsonb);
