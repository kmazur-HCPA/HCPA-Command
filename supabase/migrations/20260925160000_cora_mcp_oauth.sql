-- Claude connectors sign in through Supabase Auth's OAuth 2.1 server instead of a
-- personal token. Their tool calls share the same per-owner quota and audit table;
-- connection_id records the OAuth client ID. Server-only, like cora_mcp_reserve.
create function public.cora_mcp_reserve_oauth(p_user uuid,p_client uuid,p_tool text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare audit_id uuid;
begin
 perform 1 from public.app_memberships where user_id=p_user and active for share;
 if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
 -- Serialize this owner's reservations so concurrent calls cannot exceed the quota.
 perform pg_advisory_xact_lock(hashtextextended('cora_mcp:'||p_user::text,0));
 if (select count(*) from public.cora_mcp_activity where user_id=p_user and created_at>now()-interval '1 minute')>=30 or
    (select count(*) from public.cora_mcp_activity where user_id=p_user and created_at>now()-interval '24 hours')>=1000 then
  raise exception 'Cora connection request limit reached' using errcode='P0001';
 end if;
 insert into public.cora_mcp_activity(user_id,connection_id,tool) values(p_user,p_client,p_tool) returning id into audit_id;
 return audit_id;
end $$;
revoke all on function public.cora_mcp_reserve_oauth(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cora_mcp_reserve_oauth(uuid,uuid,text) to service_role;
