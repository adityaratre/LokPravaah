begin;

create or replace function public.janwatch_admin_delete_submitted_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_report public.reports%rowtype;
  v_assignment_count integer := 0;
  v_active_assignment_count integer := 0;
  v_evidence_paths text[];
begin
  if auth.uid() is null or not public.is_janwatch_admin() then
    raise exception 'Administrator access is required to remove a report';
  end if;

  select * into v_report
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'This report no longer exists or has already been removed';
  end if;

  if v_report.status <> 'submitted' then
    raise exception 'Only reports in Submitted status can be permanently removed here';
  end if;

  select count(*)::integer,
         count(*) filter (where status not in ('completed','cancelled'))::integer
    into v_assignment_count, v_active_assignment_count
  from public.work_assignments
  where report_id = p_report_id;

  if v_active_assignment_count > 0 then
    raise exception 'This report has an active worker assignment. Cancel the task first, then retry removal';
  end if;

  v_evidence_paths := coalesce(v_report.evidence_paths, '{}'::text[]);

  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    'report_deleted',
    'report',
    v_report.id::text,
    jsonb_build_object(
      'report_code', v_report.public_code,
      'title', left(v_report.title, 500),
      'category', v_report.category,
      'status', v_report.status::text,
      'reporter_id', v_report.reporter_id,
      'visibility', v_report.visibility::text,
      'evidence_file_count', cardinality(v_evidence_paths),
      'worker_assignment_count', v_assignment_count
    )
  );

  delete from public.reports where id = p_report_id;

  return jsonb_build_object(
    'id', v_report.id,
    'code', v_report.public_code,
    'title', v_report.title,
    'evidence_paths', to_jsonb(v_evidence_paths)
  );
end;
$function$;

revoke all on function public.janwatch_admin_delete_submitted_report(uuid) from public, anon;
grant execute on function public.janwatch_admin_delete_submitted_report(uuid) to authenticated;

commit;
