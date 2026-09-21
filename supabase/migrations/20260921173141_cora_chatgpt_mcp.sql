-- Personal MCP credentials are separate from Supabase/Microsoft credentials.
-- Store only a SHA-256 digest of a random 256-bit token; one active key per owner.
create table public.cora_mcp_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 id uuid not null unique default gen_random_uuid(),
 token_hash text not null unique check(length(token_hash)=43),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null check(expires_at > created_at),
 last_used_at timestamptz
);
create table public.cora_mcp_activity (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null,
 tool text not null check(length(tool) between 1 and 80),
 success boolean not null default false,
 created_at timestamptz not null default now()
);
create index cora_mcp_activity_owner_time on public.cora_mcp_activity(user_id,created_at desc);
alter table public.cora_mcp_connections enable row level security;
alter table public.cora_mcp_activity enable row level security;
revoke all on public.cora_mcp_connections,public.cora_mcp_activity from public,anon,authenticated;
grant select,insert,update,delete on public.cora_mcp_connections,public.cora_mcp_activity to service_role;
grant select on public.cora_mcp_activity to authenticated;
create policy cora_mcp_activity_owner on public.cora_mcp_activity for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
create trigger cora_mcp_require_membership before insert or update on public.cora_mcp_connections
 for each row execute function public.require_microsoft_membership();

create function public.disconnect_cora_mcp_on_revocation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not new.active then delete from public.cora_mcp_connections where user_id=new.user_id; end if;
 return new;
end $$;
revoke all on function public.disconnect_cora_mcp_on_revocation() from public,anon,authenticated;
grant execute on function public.disconnect_cora_mcp_on_revocation() to service_role;
create trigger membership_disconnect_cora_mcp after update of active on public.app_memberships
 for each row execute function public.disconnect_cora_mcp_on_revocation();

-- Atomic, cross-instance per-user quota; rotating a token does not reset it.
create function public.cora_mcp_reserve(p_hash text,p_tool text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.cora_mcp_connections; audit_id uuid;
begin
 select * into c from public.cora_mcp_connections where token_hash=p_hash and expires_at>now() for update;
 if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
 perform 1 from public.app_memberships where user_id=c.user_id and active for share;
 if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
 if (select count(*) from public.cora_mcp_activity where user_id=c.user_id and created_at>now()-interval '1 minute')>=30 or
    (select count(*) from public.cora_mcp_activity where user_id=c.user_id and created_at>now()-interval '24 hours')>=1000 then
  raise exception 'Cora connection request limit reached' using errcode='P0001';
 end if;
 insert into public.cora_mcp_activity(user_id,connection_id,tool) values(c.user_id,c.id,p_tool) returning id into audit_id;
 update public.cora_mcp_connections set last_used_at=now() where user_id=c.user_id;
 return audit_id;
end $$;
revoke all on function public.cora_mcp_reserve(text,text) from public,anon,authenticated;
grant execute on function public.cora_mcp_reserve(text,text) to service_role;

alter function public.export_workspace() rename to export_cora_workspace;
create function public.export_workspace() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.export_cora_workspace()||jsonb_build_object('cora_mcp_activity',coalesce((select jsonb_agg(to_jsonb(a) order by id) from public.cora_mcp_activity a),'[]'::jsonb));
 result:=jsonb_set(result,'{counts}',result->'counts'||jsonb_build_object('cora_mcp_activity',(select count(*) from public.cora_mcp_activity)));
 if octet_length(result::text)>52428800 then raise exception 'Workspace exceeds browser export size'; end if;
 return result;
end $$;
revoke all on function public.export_workspace() from public,anon;
grant execute on function public.export_workspace() to authenticated;
