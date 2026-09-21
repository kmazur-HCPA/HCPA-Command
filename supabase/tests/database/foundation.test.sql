begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into auth.users(id, email) values
 ('11111111-1111-4111-8111-111111111111','command-owner@example.test'),
 ('22222222-2222-4222-8222-222222222222','command-other@example.test'),
 ('33333333-3333-4333-8333-333333333333','command-unapproved@example.test');
insert into public.app_memberships(user_id) values
 ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
select is(has_table_privilege('anon','public.user_preferences','SELECT'),false,'anonymous cannot read preferences');
select is(has_table_privilege('authenticated','public.app_memberships','INSERT'),false,'users cannot approve themselves');
select is(has_table_privilege('authenticated','public.activity_log','INSERT'),false,'users cannot forge audit events');
select is(has_table_privilege('authenticated','public.activity_log','DELETE'),false,'users cannot delete audit events');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
select is((select count(*) from public.user_preferences),1::bigint,'owner sees only own preferences');
select is((select count(*) from public.user_preferences where user_id='22222222-2222-4222-8222-222222222222'),0::bigint,'other owner hidden');
update public.user_preferences set theme='light' where user_id='11111111-1111-4111-8111-111111111111';
select is((select version from public.user_preferences),2,'version increments');
select is((select count(*) from public.activity_log where action='UPDATE'),1::bigint,'update is audited');
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.user_preferences),0::bigint,'unapproved identity has no access');
reset role;
update public.app_memberships set active=false where user_id='11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
select is((select count(*) from public.user_preferences),0::bigint,'membership revocation invalidates data access');
select * from finish();
rollback;
