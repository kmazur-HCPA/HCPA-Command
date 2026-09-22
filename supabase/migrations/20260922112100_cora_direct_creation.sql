-- Server-only entry point: caller identity is obtained from the validated JWT/MCP grant.
-- Membership lock prevents a revoke from racing an insert. Existing work guards enforce link ownership.
create function public.cora_create_record(p_user uuid,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare wanted public.work_items; existing public.work_items;
begin
 perform 1 from public.app_memberships where user_id=p_user and active for share;
 if not found then raise exception 'Command access unavailable' using errcode='42501'; end if;
 if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>20000 or
    p_record - array['id','user_id','kind','title','body','status','priority','due_date','remind_at','snoozed_until','converted_task_id','archived','focus_slot','project_id','initiative_id','person_id','task_id','source_entry_id','entry_type','tags','goals','current_state','next_milestone','organization','person_role','details','learning_id','program_id','use_case_id','experiment_id','decision_id'] <> '{}'::jsonb then
   raise exception 'Invalid creation payload';
 end if;
 wanted:=jsonb_populate_record(null::public.work_items,p_record);
 if wanted.id is null or wanted.user_id is distinct from p_user or wanted.kind is null or
    wanted.kind not in('task','person','project','initiative','journal','program','use_case','experiment') or
    wanted.archived is distinct from false or wanted.focus_slot is not null or wanted.converted_task_id is not null or
    wanted.remind_at is not null or wanted.snoozed_until is not null then raise exception 'Unsupported direct creation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(wanted.id::text,0));
 select * into existing from public.work_items where id=wanted.id;
 if found then
   if existing.user_id<>p_user or exists(select 1 from jsonb_object_keys(p_record) k where to_jsonb(existing)->k is distinct from to_jsonb(wanted)->k) then
     raise exception 'Request already used or record changed; inspect the saved record';
   end if;
   return jsonb_build_object('saved',true,'created',false,'id',existing.id);
 end if;
 insert into public.work_items(id,user_id,kind,title,body,status,priority,due_date,archived,focus_slot,project_id,initiative_id,person_id,task_id,source_entry_id,entry_type,tags,goals,current_state,next_milestone,organization,person_role,details,learning_id,program_id,use_case_id,experiment_id,decision_id)
 values(wanted.id,p_user,wanted.kind,wanted.title,wanted.body,wanted.status,wanted.priority,wanted.due_date,false,null,wanted.project_id,wanted.initiative_id,wanted.person_id,wanted.task_id,wanted.source_entry_id,wanted.entry_type,wanted.tags,wanted.goals,wanted.current_state,wanted.next_milestone,wanted.organization,wanted.person_role,wanted.details,wanted.learning_id,wanted.program_id,wanted.use_case_id,wanted.experiment_id,wanted.decision_id);
 return jsonb_build_object('saved',true,'created',true,'id',wanted.id);
end $$;
revoke all on function public.cora_create_record(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cora_create_record(uuid,jsonb) to service_role;
