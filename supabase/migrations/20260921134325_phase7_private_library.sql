-- Files are accessible only through the authenticated validation/download function.
-- No client Storage policies: direct uploads cannot bypass validation.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('command-library','command-library',false,5242880,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.library_versions (
 id uuid primary key,
 user_id uuid not null,
 document_id uuid not null,
 filename text not null check(length(filename) between 1 and 180 and filename!~'[/\\\x00-\x1f]'),
 media_type text not null check(media_type in ('application/pdf','text/plain','text/markdown','text/csv','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','ready')),
 created_at timestamptz not null default now(),
 foreign key(user_id,document_id) references public.work_items(user_id,id)
);
alter table public.library_versions enable row level security;
revoke all on public.library_versions from public,anon,authenticated;
grant select on public.library_versions to authenticated;
grant all on public.library_versions to service_role;
create index library_owner_document on public.library_versions(user_id,document_id,created_at desc,id);
create policy library_owner on public.library_versions for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create function private.guard_library_version() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.work_items where id=new.document_id and user_id=new.user_id and kind='library' and details->>'classification' in ('Public','Internal')) then raise exception 'Document unavailable or unclassified'; end if;
 if tg_op='UPDATE' and (old.state='ready' or (to_jsonb(new)-'state')<>(to_jsonb(old)-'state')) then raise exception 'Original file versions are immutable'; end if;
 return new;
end $$;
create trigger library_guard before insert or update on public.library_versions for each row execute function private.guard_library_version();
revoke all on function private.guard_library_version() from public,anon,authenticated;
create function private.audit_library_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_log(user_id,actor_id,action,entity_type,entity_id) values(new.user_id,new.user_id,tg_op,'work_items',new.document_id);
 return new;
end $$;
create trigger library_audit after insert or update on public.library_versions for each row execute function private.audit_library_version();
revoke all on function private.audit_library_version() from public,anon,authenticated;
