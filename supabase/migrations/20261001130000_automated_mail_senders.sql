-- Senders whose mail never needs Kevin's reply (get_direct_mail marks them automated).
-- Command configuration: edit rows, no deploy. Patterns are case-insensitive, `*` is a
-- wildcard, and they match the full address or its domain.
create table public.mail_automated_senders (
 pattern text primary key check(pattern=lower(pattern) and length(pattern) between 1 and 254),
 created_at timestamptz not null default now()
);
alter table public.mail_automated_senders enable row level security;
revoke all on public.mail_automated_senders from public,anon,authenticated;
grant select,insert,delete on public.mail_automated_senders to authenticated;
grant all on public.mail_automated_senders to service_role;
create policy mail_automated_members on public.mail_automated_senders for all to authenticated
 using(exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active))
 with check(exists(select 1 from public.app_memberships where user_id=(select auth.uid()) and active));
insert into public.mail_automated_senders(pattern) values
 ('noreply@*'),('no-reply@*'),('donotreply*@*'),
 ('request_submissions@hcpaflapps.org'),('falcon@crowdstrike.com'),('*ups*@hcpafl.org'),
 ('presidio@service-now.com'),('moveitxfer@hillsclerk.com'),('standout@standoutmail.tmbc.com');
