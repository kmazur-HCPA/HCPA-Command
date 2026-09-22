-- Stable persisted order. New records append; reordering preserves all record content.
create sequence public.work_sort_order_seq;
alter table public.work_items add column sort_order bigint;
with ranked as (
 select id,row_number() over(order by created_at desc,id) as position from public.work_items
) update public.work_items w set sort_order=r.position from ranked r where w.id=r.id;
select setval('public.work_sort_order_seq',greatest(coalesce((select max(sort_order) from public.work_items),0)+1,1),false);
alter table public.work_items alter column sort_order set default nextval('public.work_sort_order_seq');
alter table public.work_items alter column sort_order set not null;
alter sequence public.work_sort_order_seq owned by public.work_items.sort_order;
grant usage on sequence public.work_sort_order_seq to authenticated,service_role;
create index work_owner_manual_order on public.work_items(user_id,kind,archived,sort_order,id);

-- Lock both rows in UUID order and check versions before swapping, under existing RLS.
create function public.swap_work_order(first_id uuid,second_id uuid,first_version integer,second_version integer)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.work_items; b public.work_items;
begin
 if auth.uid() is null or first_id=second_id then raise exception 'Invalid reorder' using errcode='42501'; end if;
 perform id from public.work_items where id in(first_id,second_id) and user_id=auth.uid() order by id for update;
 select * into a from public.work_items where id=first_id and user_id=auth.uid();
 select * into b from public.work_items where id=second_id and user_id=auth.uid();
 if a.id is null or b.id is null or a.kind not in('task','project') or a.kind<>b.kind
    or a.archived or b.archived or (a.kind='task' and a.project_id is distinct from b.project_id) then
   raise exception 'Records cannot be reordered together' using errcode='42501';
 end if;
 if a.version<>first_version or b.version<>second_version or first_version is null or second_version is null then
   raise exception 'Records changed; reload before reordering' using errcode='40001';
 end if;
 update public.work_items set sort_order=case when id=a.id then b.sort_order else a.sort_order end where id in(a.id,b.id);
end $$;
revoke all on function public.swap_work_order(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.swap_work_order(uuid,uuid,integer,integer) to authenticated;
