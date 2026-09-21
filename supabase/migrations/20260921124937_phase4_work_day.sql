alter table public.work_items add column focus_slot smallint check(focus_slot is null or (focus_slot between 1 and 3 and kind='task'));
-- A unique slot, not a count-then-write check, prevents concurrent fourth priorities.
create unique index work_focus_slot on public.work_items(user_id,focus_slot) where focus_slot is not null and not archived and status not in ('Complete','Cancelled');
create index work_reminder_state on public.work_items(user_id,status,snoozed_until) where kind='reminder' and not archived;
