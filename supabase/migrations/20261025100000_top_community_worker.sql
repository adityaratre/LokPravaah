-- Public, privacy-minimised #1 worker card for the website and native app.
-- Only the worker display name and count of operations-approved completed assignments are returned.
create or replace function public.janwatch_get_top_community_worker()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'worker_name',
    coalesce(nullif(btrim(p.display_name), ''), 'LokPravaah Volunteer ' || left(w.user_id::text, 6)),
    'completed_tasks',
    w.completed_tasks
  )
  from (
    select worker_id, count(*)::integer as completed_tasks
    from public.work_assignments
    where status = 'completed'
    group by worker_id
  ) w
  join public.worker_profiles wp on wp.user_id = w.worker_id
  left join public.profiles p on p.id = w.worker_id
  order by w.completed_tasks desc, wp.created_at asc, w.worker_id asc
  limit 1;
$$;

revoke all on function public.janwatch_get_top_community_worker() from public;
grant execute on function public.janwatch_get_top_community_worker() to anon, authenticated;
