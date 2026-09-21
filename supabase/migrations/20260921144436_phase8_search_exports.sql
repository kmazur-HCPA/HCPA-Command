-- With text[] input this projection is independent of locale/session settings.
create function public.search_tags(tags text[]) returns tsvector language sql immutable security invoker set search_path='' as $$
 select to_tsvector('simple',array_to_string(tags,' '))||to_tsvector('english',array_to_string(tags,' '));
$$;
revoke all on function public.search_tags(text[]) from public,anon;
grant execute on function public.search_tags(text[]) to authenticated,service_role;
-- Expand the existing indexed projection without touching source records or revisions.
-- All detail keys are already allowlisted by guard_lab; only string values enter search.
alter table public.work_items drop column search_vector;
alter table public.work_items add column search_vector tsvector generated always as (
 setweight(to_tsvector('english',title)||to_tsvector('simple',title),'A') ||
 setweight(public.search_tags(tags),'A') ||
 setweight(to_tsvector('english',goals||' '||current_state||' '||next_milestone||' '||organization||' '||person_role||' '||entry_type)||jsonb_to_tsvector('english',details,'["string"]')||jsonb_to_tsvector('simple',details,'["string"]'),'B') ||
 setweight(to_tsvector('english',body||' '||original_body)||to_tsvector('simple',body||' '||original_body),'C')
) stored;
create index work_search on public.work_items using gin(search_vector);
create index library_filename_search on public.library_versions using gin((to_tsvector('english',filename)||to_tsvector('simple',filename)));

create function public.search_work(query_text text, module_filter text default null, status_filter text default null,
 archive_filter text default 'current', tag_filter text default null, page_offset integer default 0)
returns table(id uuid,kind text,title text,status text,priority text,archived boolean,tags text[],updated_at timestamptz,excerpt text,rank real)
language plpgsql stable security invoker set search_path='' as $$
declare q tsquery; prefix_q tsquery; cleaned text:=btrim(query_text);
begin
 if length(cleaned)>200 or page_offset<0 or page_offset>10000 or archive_filter not in ('current','archived','all') then raise exception 'Invalid search parameters' using errcode='22023'; end if;
 if cleaned is null or length(cleaned)<2 then return; end if;
 q:=websearch_to_tsquery('english',cleaned) || websearch_to_tsquery('simple',cleaned);
 -- Plain input also matches token prefixes. Quoted phrases/OR/negation retain web-search semantics.
 if cleaned ~ '^[[:alnum:]_[:space:]]+$' and cleaned !~* '\mOR\M' then
   select to_tsquery('simple',string_agg(quote_literal(token)||':*',' & ')) into prefix_q
   from unnest(regexp_split_to_array(cleaned,'\s+')) token;
   q:=q||prefix_q;
 end if;
 -- Reject negative-only queries that would enumerate the whole index.
 if numnode(q)=0 or querytree(q)='T' then return; end if;
 return query
 with matches as (
   select w.id,ts_rank_cd(w.search_vector,q) as score from public.work_items w
   where w.user_id=(select auth.uid()) and w.search_vector@@q
   union all
   select v.document_id,0.25::real from public.library_versions v
   where v.user_id=(select auth.uid()) and v.state='ready' and (to_tsvector('english',v.filename)||to_tsvector('simple',v.filename))@@q
 ), ranked as (
   select w.id,w.kind,w.title,w.status,w.priority,w.archived,w.tags,w.updated_at,
     w.body||' '||w.original_body||' '||w.goals||' '||w.current_state||' '||w.next_milestone||' '||w.organization||' '||w.person_role as context,w.details,
     (max(m.score)+case when lower(w.title)=lower(cleaned) then 10 else 0 end)::real as score
   from matches m join public.work_items w on w.id=m.id
   where w.user_id=(select auth.uid()) and (module_filter is null or w.kind=module_filter)
     and (status_filter is null or w.status=status_filter)
     and (archive_filter='all' or w.archived=(archive_filter='archived'))
     and (nullif(tag_filter,'') is null or w.tags@>array[tag_filter])
   group by w.id
   order by score desc,w.updated_at desc,w.id
   limit 26 offset page_offset
 )
 select r.id,r.kind,r.title,r.status,r.priority,r.archived,r.tags,r.updated_at,
   ts_headline('english',r.context||' '||coalesce((select string_agg(value,' · ') from jsonb_each_text(r.details)),'')||' '||coalesce((select string_agg(v.filename,' ') from public.library_versions v where v.document_id=r.id and v.state='ready' and (to_tsvector('english',v.filename)||to_tsvector('simple',v.filename))@@q),''),q,'StartSel=,StopSel=,MaxWords=30,MinWords=8,MaxFragments=1'),r.score
 from ranked r order by r.score desc,r.updated_at desc,r.id;
end $$;
revoke all on function public.search_work(text,text,text,text,text,integer) from public,anon;
grant execute on function public.search_work(text,text,text,text,text,integer) to authenticated;

-- One MVCC snapshot: records, links, history, file manifest and counts agree even
-- while another device saves. Original bytes are immutable and checked by SHA-256.
create function public.export_workspace() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select jsonb_build_object(
  'format','command-workspace','format_version',1,'exported_at',statement_timestamp(),'user_id',(select auth.uid()),
  'work_items',coalesce((select jsonb_agg(to_jsonb(w)-'search_vector' order by w.id) from public.work_items w),'[]'::jsonb),
  'journal_revisions',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.journal_revisions r),'[]'::jsonb),
  'library_versions',coalesce((select jsonb_agg(to_jsonb(v)-'search_vector' order by v.id) from public.library_versions v),'[]'::jsonb),
  'user_preferences',coalesce((select jsonb_agg(to_jsonb(p)) from public.user_preferences p),'[]'::jsonb),
  'activity_log',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.activity_log a),'[]'::jsonb),
  'app_memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.app_memberships m),'[]'::jsonb),
  'counts',jsonb_build_object('work_items',(select count(*) from public.work_items),'journal_revisions',(select count(*) from public.journal_revisions),'library_versions',(select count(*) from public.library_versions),'activity_log',(select count(*) from public.activity_log),'user_preferences',(select count(*) from public.user_preferences),'app_memberships',(select count(*) from public.app_memberships))
 ) into result;
 if octet_length(result::text)>52428800 then raise exception 'Workspace exceeds browser export size; use the administrator backup procedure'; end if;
 return result;
end $$;
revoke all on function public.export_workspace() from public,anon;
grant execute on function public.export_workspace() to authenticated;
