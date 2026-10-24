begin;

-- Worker reward enablement must not disable task offers; these are independent controls.
create or replace function public.janwatch_auto_offer_report(p_report_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_settings public.worker_settings%rowtype;
  v_report public.reports%rowtype;
  v_worker public.worker_profiles%rowtype;
  v_assignment uuid;
  v_timeout integer;
  v_difficulty text;
begin
  select * into v_settings from public.worker_settings where id=true;
  if not found or not coalesce(v_settings.auto_assignment_enabled,false) then
    return null;
  end if;

  select * into v_report from public.reports where id=p_report_id for update;
  if not found or v_report.visibility <> 'public' or v_report.status in ('resolved','rejected') then return null; end if;
  if exists(select 1 from public.work_assignments where report_id=v_report.id and status not in ('completed','cancelled')) then return null; end if;

  v_difficulty := case v_report.suggested_severity when 'urgent' then 'hard' when 'high' then 'medium' else 'easy' end;
  v_timeout := greatest(5, least(10080, coalesce(v_settings.offer_timeout_minutes,60)));

  select w.* into v_worker
  from public.worker_profiles w
  where w.status='active' and w.available
    and (
      exists(select 1 from unnest(coalesce(w.skills,'{}'::text[])) as skill where lower(trim(skill))=lower(trim(v_report.category)))
      or (lower(coalesce(v_report.category,''))='other'
          and w.skills && array['Community outreach','Evidence collection','Digital support']::text[])
    )
    and (select count(*) from public.work_assignments a where a.worker_id=w.user_id and a.status not in ('completed','cancelled')) < w.max_active_tasks
  order by
    case when nullif(trim(w.ward),'') is not null and position(lower(trim(w.ward)) in lower(coalesce(v_report.address_label,''))) > 0 then 0 else 1 end,
    case when nullif(trim(w.city),'') is not null and position(lower(trim(w.city)) in lower(coalesce(v_report.address_label,''))) > 0 then 0 else 1 end,
    (select count(*) from public.work_assignments a where a.worker_id=w.user_id and a.status not in ('completed','cancelled')) asc,
    w.created_at asc
  limit 1
  for update of w skip locked;

  if not found then return null; end if;

  insert into public.work_assignments(report_id,worker_id,assigned_by,due_at,status,difficulty,offer_expires_at)
  values(v_report.id,v_worker.user_id,null,null,'assigned',v_difficulty,now() + make_interval(mins => v_timeout))
  returning id into v_assignment;

  insert into public.work_events(assignment_id,actor_id,action,note)
  values(v_assignment,null,'auto_assigned','Automatic worker offer: category/skills matched, with local-area and current workload used as priorities.');

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(null,'worker_auto_assigned','work_assignment',v_assignment::text,
    jsonb_build_object('report_id',v_report.id,'worker_id',v_worker.user_id,'category',v_report.category,'difficulty',v_difficulty,'offer_expires_at',now() + make_interval(mins => v_timeout)));
  return v_assignment;
end;
$function$;

commit;
