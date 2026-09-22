-- Directory contacts retain their existing IDs, links and indexed details projection.
create or replace function private.guard_lab() returns trigger language plpgsql set search_path='' as $$
declare link_id uuid; expected_kind text; k text; v jsonb; allowed text[];
begin
 for link_id,expected_kind in select * from (values (new.learning_id,'learning'),(new.program_id,'program'),(new.use_case_id,'use_case'),(new.experiment_id,'experiment'),(new.decision_id,'journal')) as links(id,kind) loop
 if link_id is not null and (link_id=new.id or not exists(select 1 from public.work_items where id=link_id and user_id=new.user_id and kind=expected_kind and (expected_kind<>'journal' or entry_type='Decision'))) then raise exception 'Invalid learning or lab link' using errcode='23514'; end if;
 end loop;
 if new.kind='journal' and new.entry_type<>'Decision' and exists(select 1 from public.work_items where user_id=new.user_id and decision_id=new.id) then raise exception 'This entry is referenced as a decision; retain its Decision type'; end if;
 allowed := case new.kind
 when 'person' then array['email','phone','mobile','department','location']
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
 if new.kind='person' then
   if length(coalesce(new.details->>'email',''))>254 or (coalesce(new.details->>'email','')<>'' and (new.details->>'email') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$') then raise exception 'Invalid contact email'; end if;
   if length(coalesce(new.details->>'phone',''))>80 or length(coalesce(new.details->>'mobile',''))>80 or coalesce(new.details->>'phone','') ~ '[[:cntrl:]]' or coalesce(new.details->>'mobile','') ~ '[[:cntrl:]]' then raise exception 'Invalid contact phone'; end if;
   if length(coalesce(new.details->>'department',''))>240 or length(coalesce(new.details->>'location',''))>240 then raise exception 'Contact field too long'; end if;
 end if;
 return new;
end $$;
create index people_email_match on public.work_items(user_id,lower(btrim(details->>'email'))) where kind='person';
create index people_name_match on public.work_items(user_id,lower(btrim(title)),lower(btrim(organization))) where kind='person';
create index people_directory_order on public.work_items(user_id,archived,lower(title),id) where kind='person';

create function public.directory_people(query_text text default '',show_archived boolean default false,page_offset integer default 0)
returns table(id uuid,title text,organization text,person_role text,details jsonb,archived boolean,version integer,notes_excerpt text)
language plpgsql stable security invoker set search_path='' as $$
declare q text:=lower(btrim(coalesce(query_text,'')));
begin
 if length(q)>200 or page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid directory query'; end if;
 return query select w.id,w.title,w.organization,w.person_role,w.details,w.archived,w.version,left(w.body,240)
 from public.work_items w
 where w.user_id=(select auth.uid()) and w.kind='person' and w.archived=show_archived
 and (q='' or strpos(lower(w.title||' '||w.organization||' '||w.person_role||' '||coalesce(w.details->>'email','')||' '||coalesce(w.details->>'phone','')||' '||coalesce(w.details->>'mobile','')||' '||coalesce(w.details->>'department','')||' '||coalesce(w.details->>'location','')||' '||w.body),q)>0)
 order by lower(w.title),w.id limit 51 offset page_offset;
end $$;
revoke all on function public.directory_people(text,boolean,integer) from public,anon;
grant execute on function public.directory_people(text,boolean,integer) to authenticated;

-- Add-only, atomic import. Existing/archived contacts and retries are skipped, never overwritten.
create function public.import_people(contacts jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); c jsonb; contact_id uuid; found_id uuid; name_text text; email_text text; org_text text; made integer:=0; skipped integer:=0; receipts jsonb:='[]';
begin
 if owner_id is null or not exists(select 1 from public.app_memberships where user_id=owner_id and active) then raise exception 'Directory access unavailable' using errcode='42501'; end if;
 if contacts is null or jsonb_typeof(contacts)<>'array' or jsonb_array_length(contacts) not between 1 and 500 or octet_length(contacts::text)>2097152 then raise exception 'Import up to 500 contacts and 2 MB at a time'; end if;
 perform pg_advisory_xact_lock(hashtextextended('people-import:'||owner_id::text,0));
 for c in select value from jsonb_array_elements(contacts) loop
   if jsonb_typeof(c)<>'object' or c - array['id','name','email','job_title','organization','phone','mobile','department','location','notes'] <> '{}'::jsonb or exists(select 1 from jsonb_each(c) f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid contact fields'; end if;
   contact_id:=(c->>'id')::uuid;name_text:=btrim(c->>'name');email_text:=lower(btrim(coalesce(c->>'email','')));org_text:=btrim(coalesce(c->>'organization',''));
   if contact_id is null or name_text is null or length(name_text) not between 1 and 240 or length(coalesce(c->>'notes',''))>10000 or length(org_text)>240 or length(coalesce(c->>'job_title',''))>240 then raise exception 'Invalid contact name or field length'; end if;
   -- Validate even skipped rows so malformed files cannot appear successful.
   if length(email_text)>254 or (email_text<>'' and email_text !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$') or length(coalesce(c->>'phone',''))>80 or length(coalesce(c->>'mobile',''))>80 or coalesce(c->>'phone','') ~ '[[:cntrl:]]' or coalesce(c->>'mobile','') ~ '[[:cntrl:]]' or length(coalesce(c->>'department',''))>240 or length(coalesce(c->>'location',''))>240 then raise exception 'Invalid contact details'; end if;
   select w.id into found_id from public.work_items w where w.user_id=owner_id and w.kind='person' and
    (w.id=contact_id or (email_text<>'' and lower(btrim(w.details->>'email'))=email_text) or (lower(btrim(w.title))=lower(name_text) and lower(btrim(w.organization))=lower(org_text))) order by w.id limit 1;
   if found then
     skipped:=skipped+1;receipts:=receipts||jsonb_build_array(jsonb_build_object('id',found_id,'status','skipped'));continue;
   end if;
   insert into public.work_items(id,user_id,kind,title,body,status,person_role,organization,details)
   values(contact_id,owner_id,'person',name_text,coalesce(c->>'notes',''),'Active',btrim(coalesce(c->>'job_title','')),org_text,
    jsonb_build_object('email',email_text,'phone',btrim(coalesce(c->>'phone','')),'mobile',btrim(coalesce(c->>'mobile','')),'department',btrim(coalesce(c->>'department','')),'location',btrim(coalesce(c->>'location',''))));
   made:=made+1;receipts:=receipts||jsonb_build_array(jsonb_build_object('id',contact_id,'status','created'));
 end loop;
 return jsonb_build_object('created',made,'skipped',skipped,'results',receipts);
end $$;
revoke all on function public.import_people(jsonb) from public,anon;
grant execute on function public.import_people(jsonb) to authenticated;
