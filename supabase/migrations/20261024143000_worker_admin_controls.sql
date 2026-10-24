begin;

alter table public.worker_settings
  add column if not exists auto_assignment_enabled boolean not null default false,
  add column if not exists offer_timeout_minutes integer not null default 60,
  add column if not exists max_auto_assignments_per_run integer not null default 25,
  add column if not exists category_difficulty_points jsonb not null default
    '{
      "Roads & Footpaths":{"easy":10,"medium":25,"hard":50},
      "Waste & Sanitation":{"easy":10,"medium":25,"hard":50},
      "Streetlights":{"easy":10,"medium":25,"hard":50},
      "Water & Drainage":{"easy":10,"medium":25,"hard":50},
      "Public Safety":{"easy":10,"medium":25,"hard":50},
      "Parks & Public Spaces":{"easy":10,"medium":25,"hard":50},
      "Other":{"easy":10,"medium":25,"hard":50}
    }'::jsonb;

alter table public.worker_settings
  drop constraint if exists worker_settings_offer_timeout_minutes_check,
  add constraint worker_settings_offer_timeout_minutes_check
    check (offer_timeout_minutes between 5 and 10080),
  drop constraint if exists worker_settings_max_auto_assignments_per_run_check,
  add constraint worker_settings_max_auto_assignments_per_run_check
    check (max_auto_assignments_per_run between 1 and 100);

update public.worker_settings
set category_difficulty_points = '{
  "Roads & Footpaths":{"easy":10,"medium":25,"hard":50},
  "Waste & Sanitation":{"easy":10,"medium":25,"hard":50},
  "Streetlights":{"easy":10,"medium":25,"hard":50},
  "Water & Drainage":{"easy":10,"medium":25,"hard":50},
  "Public Safety":{"easy":10,"medium":25,"hard":50},
  "Parks & Public Spaces":{"easy":10,"medium":25,"hard":50},
  "Other":{"easy":10,"medium":25,"hard":50}
}'::jsonb
where category_difficulty_points is null or category_difficulty_points = '{}'::jsonb;

alter table public.work_assignments
  add column if not exists difficulty text not null default 'medium',
  add column if not exists offer_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.work_assignments'::regclass
      and conname = 'work_assignments_difficulty_check'
  ) then
    alter table public.work_assignments
      add constraint work_assignments_difficulty_check
      check (difficulty in ('easy','medium','hard'));
  end if;
end
$$;

create or replace function public.janwatch_worker_reward_points(p_category text, p_difficulty text)
returns integer
language plpgsql
stable
security definer
set search_path = public, auth
as $function$
declare
  v_base integer;
  v_rules jsonb;
  v_value text;
begin
  select points_per_approved_task, category_difficulty_points
    into v_base, v_rules
  from public.worker_settings where id = true;

  v_value := v_rules #>> array[coalesce(p_category, 'Other'), coalesce(p_difficulty, 'medium')];
  if v_value ~ '^[0-9]{1,6}$' then
    return least(v_value::integer, 100000);
  end if;
  return greatest(0, coalesce(v_base, 25));
end;
$function$;

create or replace function public.janwatch_admin_assign_work_with_options(
  p_report_id uuid,
  p_worker_id uuid,
  p_due_at timestamptz default null,
  p_difficulty text default 'medium'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_report public.reports%rowtype;
  v_worker public.worker_profiles%rowtype;
  v_open_count integer;
  v_assignment uuid;
  v_timeout integer;
  v_difficulty text := coalesce(p_difficulty, 'medium');
begin
  if auth.uid() is null or not public.is_janwatch_admin() then
    raise exception 'Administrator access is required';
  end if;
  if v_difficulty not in ('easy','medium','hard') then
    raise exception 'Choose an allowed task difficulty';
  end if;
  if p_due_at is not null and p_due_at < now() then
    raise exception 'Due date must be in the future';
  end if;

  select coalesce(offer_timeout_minutes,60) into v_timeout
  from public.worker_settings where id = true;
  v_timeout := greatest(5, least(10080, coalesce(v_timeout,60)));

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report was not found'; end if;
  if v_report.visibility <> 'public' then raise exception 'Only public reports can be assigned to a worker'; end if;
  if v_report.status in ('resolved','rejected') then raise exception 'Resolved or rejected reports cannot receive a new assignment'; end if;

  select * into v_worker from public.worker_profiles where user_id = p_worker_id for update;
  if not found then raise exception 'Worker application was not found'; end if;
  if v_worker.status <> 'active' then raise exception 'Choose an approved, active worker'; end if;
  if not v_worker.available then raise exception 'This worker is currently unavailable'; end if;

  select count(*) into v_open_count from public.work_assignments
  where worker_id = p_worker_id and status not in ('completed','cancelled');
  if v_open_count >= v_worker.max_active_tasks then raise exception 'Worker has reached their active task limit'; end if;
  if exists(select 1 from public.work_assignments where report_id = p_report_id and status not in ('completed','cancelled')) then
    raise exception 'This report already has an active work assignment';
  end if;

  insert into public.work_assignments(report_id,worker_id,assigned_by,due_at,status,difficulty,offer_expires_at)
  values(p_report_id,p_worker_id,auth.uid(),p_due_at,'assigned',v_difficulty,now() + make_interval(mins => v_timeout))
  returning id into v_assignment;

  insert into public.work_events(assignment_id,actor_id,action,note)
  values(v_assignment,auth.uid(),'assigned','Task offered by an authorised operations administrator.');

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'work_assigned','work_assignment',v_assignment::text,
    jsonb_build_object('report_id',p_report_id,'worker_id',p_worker_id,'due_at',p_due_at,'difficulty',v_difficulty,'offer_expires_at',now() + make_interval(mins => v_timeout)));
  return v_assignment;
end;
$function$;

create or replace function public.janwatch_admin_assign_work(
  p_report_id uuid,
  p_worker_id uuid,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
begin
  return public.janwatch_admin_assign_work_with_options(p_report_id,p_worker_id,p_due_at,'medium');
end;
$function$;

create or replace function public.janwatch_expire_worker_offers()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_task public.work_assignments%rowtype;
  v_count integer := 0;
begin
  for v_task in
    select * from public.work_assignments
    where status='assigned' and offer_expires_at is not null and offer_expires_at <= now()
    for update skip locked
  loop
    update public.work_assignments
      set status='cancelled', updated_at=now()
      where id=v_task.id and status='assigned' and offer_expires_at <= now();
    if found then
      insert into public.work_events(assignment_id,actor_id,action,note)
      values(v_task.id,null,'offer_expired','The worker offer expired before acceptance and returned to the unassigned queue.');
      insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
      values(null,'worker_offer_expired','work_assignment',v_task.id::text,
        jsonb_build_object('report_id',v_task.report_id,'worker_id',v_task.worker_id,'offer_expires_at',v_task.offer_expires_at));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

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
  if not found or not coalesce(v_settings.enabled,false) or not coalesce(v_settings.auto_assignment_enabled,false) then
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

create or replace function public.janwatch_admin_run_auto_assignment(p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_settings public.worker_settings%rowtype;
  v_report_id uuid;
  v_limit integer;
  v_assigned integer := 0;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  select * into v_settings from public.worker_settings where id=true;
  if not found or not coalesce(v_settings.auto_assignment_enabled,false) then raise exception 'Enable automatic worker assignment in Worker settings first'; end if;

  perform public.janwatch_expire_worker_offers();
  v_limit := greatest(1,least(100,coalesce(p_limit,v_settings.max_auto_assignments_per_run,25)));

  for v_report_id in
    select r.id from public.reports r
    where r.visibility='public' and r.status not in ('resolved','rejected')
      and not exists(select 1 from public.work_assignments a where a.report_id=r.id and a.status not in ('completed','cancelled'))
    order by case r.suggested_severity when 'urgent' then 0 when 'high' then 1 else 2 end, r.created_at asc
    limit v_limit
  loop
    if public.janwatch_auto_offer_report(v_report_id) is not null then v_assigned := v_assigned + 1; end if;
  end loop;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'worker_auto_assignment_run','worker_settings','true',jsonb_build_object('requested_limit',v_limit,'assigned_count',v_assigned));
  return v_assigned;
end;
$function$;

create or replace function public.janwatch_trigger_auto_worker_offer()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
begin
  perform public.janwatch_expire_worker_offers();
  perform public.janwatch_auto_offer_report(new.id);
  return new;
end;
$function$;

drop trigger if exists janwatch_auto_worker_offer_on_report_insert on public.reports;
create trigger janwatch_auto_worker_offer_on_report_insert
after insert on public.reports
for each row execute function public.janwatch_trigger_auto_worker_offer();

drop trigger if exists janwatch_auto_worker_offer_on_report_reclassify on public.reports;
create trigger janwatch_auto_worker_offer_on_report_reclassify
after update of visibility,status,category,address_label on public.reports
for each row execute function public.janwatch_trigger_auto_worker_offer();

create or replace function public.janwatch_admin_review_assignment(
  p_assignment_id uuid,
  p_action text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_row public.work_assignments%rowtype;
  v_next text;
  v_settings_enabled boolean;
  v_points integer;
  v_reward_enabled boolean;
  v_category text;
  v_public_code text;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  if p_action is null or p_action not in ('approve','request_changes','cancel') then raise exception 'Unsupported task review action'; end if;

  select * into v_row from public.work_assignments where id=p_assignment_id for update;
  if not found then raise exception 'Task assignment was not found'; end if;
  if p_action in ('approve','request_changes') and v_row.status <> 'submitted_for_review' then raise exception 'Only submitted tasks can be reviewed'; end if;
  if p_action='cancel' and v_row.status in ('completed','cancelled') then raise exception 'This task is already closed'; end if;

  v_next := case p_action when 'approve' then 'completed' when 'request_changes' then 'changes_requested' else 'cancelled' end;
  update public.work_assignments set status=v_next,updated_at=now() where id=p_assignment_id;

  insert into public.work_events(assignment_id,actor_id,action,note)
  values(p_assignment_id,auth.uid(),v_next,nullif(left(btrim(coalesce(p_note,'')),1000),''));

  if p_action='approve' and not v_row.reward_points_awarded then
    select enabled into v_settings_enabled from public.worker_settings where id=true;
    select coalesce((select enabled from public.reward_settings where id=true),false)
      and exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled)
      into v_reward_enabled;
    select category,public_code into v_category,v_public_code from public.reports where id=v_row.report_id;
    v_points := public.janwatch_worker_reward_points(v_category,v_row.difficulty);

    if coalesce(v_settings_enabled,false) and coalesce(v_reward_enabled,false) and coalesce(v_points,0)>0 then
      insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
      values(v_row.worker_id,v_points,'Approved volunteer task ('||coalesce(v_category,'Other')||' / '||coalesce(v_row.difficulty,'medium')||'): '||coalesce(v_public_code,'LokPravaah report'),v_row.report_id,auth.uid());
      update public.work_assignments set reward_points_awarded=true where id=p_assignment_id;
    end if;
  end if;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'work_'||p_action,'work_assignment',p_assignment_id::text,
    jsonb_build_object('old_status',v_row.status,'new_status',v_next,'difficulty',v_row.difficulty,'note',left(coalesce(p_note,''),500)));
  return v_next;
end;
$function$;

create or replace function public.janwatch_admin_award_pending_worker_task_rewards()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_task public.work_assignments%rowtype;
  v_points integer;
  v_category text;
  v_public_code text;
  v_awarded integer := 0;
  v_worker_enabled boolean;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;

  select enabled into v_worker_enabled from public.worker_settings where id=true;
  if not coalesce(v_worker_enabled,false) then return 0; end if;
  if not exists(select 1 from public.reward_settings where id=true and enabled)
     or not exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled) then
    raise exception 'Enable the main Rewards setting and Rewards feature before awarding worker points';
  end if;

  for v_task in
    select * from public.work_assignments
    where status='completed' and not reward_points_awarded
    order by updated_at,created_at for update skip locked
  loop
    select category,public_code into v_category,v_public_code from public.reports where id=v_task.report_id;
    v_points := public.janwatch_worker_reward_points(v_category,v_task.difficulty);
    if coalesce(v_points,0) <= 0 then continue; end if;
    insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
    values(v_task.worker_id,v_points,'Approved volunteer task ('||coalesce(v_category,'Other')||' / '||coalesce(v_task.difficulty,'medium')||'): '||coalesce(v_public_code,'LokPravaah report'),v_task.report_id,auth.uid());
    update public.work_assignments set reward_points_awarded=true where id=v_task.id and not reward_points_awarded;
    if found then v_awarded := v_awarded + 1; end if;
  end loop;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'worker_task_rewards_reconciled','worker_settings','true',jsonb_build_object('awarded_count',v_awarded));
  return v_awarded;
end;
$function$;

create or replace function public.janwatch_worker_update_assignment(
  p_assignment_id uuid,
  p_action text,
  p_note text default null,
  p_evidence_urls text[] default '{}'::text[]
)
returns public.work_assignments
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.work_assignments%rowtype;
  v_next text;
  v_urls text[];
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  if not exists(select 1 from public.worker_profiles where user_id=v_user and status='active') then
    raise exception 'Only approved, active workers can update assignments';
  end if;

  select * into v_row from public.work_assignments where id=p_assignment_id and worker_id=v_user for update;
  if not found then raise exception 'This task does not belong to your account'; end if;
  if char_length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;

  v_urls := coalesce(p_evidence_urls,'{}'::text[]);
  if cardinality(v_urls)>5 then raise exception 'Attach no more than five evidence links'; end if;
  if exists(
    select 1 from unnest(v_urls) as url_rows(url)
    where char_length(url)>1000
      or not (url ~* '^https://[^[:space:]]+$'
        or url like 'storage://citizen-evidence/'||v_user::text||'/worker-work/%')
  ) then
    raise exception 'Evidence must be an HTTPS link or a file uploaded to your own worker evidence folder';
  end if;

  if p_action='accept' and v_row.status='assigned'
     and v_row.offer_expires_at is not null and v_row.offer_expires_at <= now() then
    update public.work_assignments set status='cancelled',updated_at=now()
      where id=p_assignment_id returning * into v_row;
    insert into public.work_events(assignment_id,actor_id,action,note)
      values(p_assignment_id,v_user,'offer_expired','The worker offer expired before acceptance and returned to the unassigned queue.');
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
      values(v_user,'worker_offer_expired','work_assignment',p_assignment_id::text,jsonb_build_object('report_id',v_row.report_id));
    return v_row;
  end if;

  if p_action='accept' and v_row.status='assigned' then v_next:='accepted';
  elsif p_action='decline' and v_row.status='assigned' then v_next:='cancelled';
  elsif p_action='start' and v_row.status in ('accepted','changes_requested') then v_next:='in_progress';
  elsif p_action='submit' and v_row.status='in_progress' then
    if char_length(btrim(coalesce(p_note,'')))<15 and cardinality(v_urls)=0 then
      raise exception 'Add a completion note (at least 15 characters) or an evidence link';
    end if;
    v_next:='submitted_for_review';
  else
    raise exception 'That action is not available for the current task status';
  end if;

  update public.work_assignments
  set status=v_next,
      worker_note=case when p_action in ('accept','start','decline') then nullif(left(btrim(coalesce(p_note,'')),2000),'') else worker_note end,
      completion_note=case when p_action='submit' then nullif(left(btrim(coalesce(p_note,'')),2000),'') else completion_note end,
      evidence_urls=case when p_action='submit' then v_urls else evidence_urls end,
      updated_at=now()
  where id=p_assignment_id returning * into v_row;

  insert into public.work_events(assignment_id,actor_id,action,note)
  values(p_assignment_id,v_user,case when p_action='decline' then 'declined' else v_next end,nullif(left(btrim(coalesce(p_note,'')),1000),''));
  return v_row;
end;
$function$;

create or replace function public.janwatch_admin_set_worker_limits(
  p_worker_id uuid,
  p_max_active_tasks integer,
  p_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_old public.worker_profiles%rowtype;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  if p_worker_id=auth.uid() then raise exception 'You cannot change your own worker limits'; end if;
  if p_max_active_tasks not between 1 and 10 then raise exception 'Maximum active tasks must be between 1 and 10'; end if;

  select * into v_old from public.worker_profiles where user_id=p_worker_id for update;
  if not found then raise exception 'Worker application was not found'; end if;
  update public.worker_profiles set max_active_tasks=p_max_active_tasks,available=coalesce(p_available,available),updated_at=now()
  where user_id=p_worker_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'worker_limits_updated','worker',p_worker_id::text,jsonb_build_object(
    'old_max_active_tasks',v_old.max_active_tasks,'new_max_active_tasks',p_max_active_tasks,
    'old_available',v_old.available,'new_available',coalesce(p_available,v_old.available)));
end;
$function$;

revoke all on function public.janwatch_worker_reward_points(text,text) from public, anon, authenticated;
revoke all on function public.janwatch_expire_worker_offers() from public, anon, authenticated;
revoke all on function public.janwatch_auto_offer_report(uuid) from public, anon, authenticated;
revoke all on function public.janwatch_trigger_auto_worker_offer() from public, anon, authenticated;

revoke all on function public.janwatch_admin_assign_work_with_options(uuid,uuid,timestamptz,text) from public, anon;
grant execute on function public.janwatch_admin_assign_work_with_options(uuid,uuid,timestamptz,text) to authenticated;
revoke all on function public.janwatch_admin_run_auto_assignment(integer) from public, anon;
grant execute on function public.janwatch_admin_run_auto_assignment(integer) to authenticated;
revoke all on function public.janwatch_admin_set_worker_limits(uuid,integer,boolean) from public, anon;
grant execute on function public.janwatch_admin_set_worker_limits(uuid,integer,boolean) to authenticated;

commit;
