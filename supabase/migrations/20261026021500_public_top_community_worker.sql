begin;

create or replace function public.janwatch_get_top_community_worker()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $function$
  select coalesce(
    (
      select jsonb_build_object(
        'worker_name', coalesce(nullif(trim(p.display_name), ''), 'Community worker'),
        'completed_tasks', count(wa.id)
      )
      from public.work_assignments wa
      join public.worker_profiles wp on wp.user_id = wa.worker_id
      left join public.profiles p on p.id = wp.user_id
      where wa.status = 'completed'
        and wp.status = 'active'
      group by p.display_name, wp.user_id
      order by count(wa.id) desc, wp.user_id asc
      limit 1
    ),
    jsonb_build_object('worker_name', '', 'completed_tasks', 0)
  );
$function$;

revoke all on function public.janwatch_get_top_community_worker() from public;
grant execute on function public.janwatch_get_top_community_worker() to authenticated;

commit;
