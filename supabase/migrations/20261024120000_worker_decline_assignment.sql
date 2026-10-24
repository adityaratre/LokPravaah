-- Worker workflow reliability patch for existing LokPravaah worker schema.
-- Apply in Supabase SQL Editor after lokpravaah_final_worker_blog_patch.sql.
-- Adds a safe decline path; declined work becomes available for reassignment.

create or replace function public.janwatch_worker_update_assignment(
  p_assignment_id uuid, p_action text, p_note text default null, p_evidence_urls text[] default '{}'
) returns public.work_assignments
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_row public.work_assignments%rowtype;
  v_next text;
  v_urls text[];
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  if not exists (
    select 1 from public.worker_profiles where user_id=v_user and status='active'
  ) then
    raise exception 'Only approved, active workers can update assignments';
  end if;

  select * into v_row
  from public.work_assignments
  where id=p_assignment_id and worker_id=v_user
  for update;
  if not found then raise exception 'This task does not belong to your account'; end if;
  if char_length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;

  v_urls := coalesce(p_evidence_urls,'{}'::text[]);
  if cardinality(v_urls) > 5 then raise exception 'Attach no more than five evidence links'; end if;
  if exists (
    select 1 from unnest(v_urls) as url_rows(url)
    where char_length(url)>1000
      or not (
        url ~* '^https://[^[:space:]]+$'
        or url like 'storage://citizen-evidence/'||v_user::text||'/worker-work/%'
      )
  ) then
    raise exception 'Evidence must be an HTTPS link or a file uploaded to your own worker evidence folder';
  end if;

  if p_action='accept' and v_row.status='assigned' then
    v_next:='accepted';
  elsif p_action='decline' and v_row.status='assigned' then
    v_next:='cancelled';
  elsif p_action='start' and v_row.status in ('accepted','changes_requested') then
    v_next:='in_progress';
  elsif p_action='submit' and v_row.status='in_progress' then
    if char_length(btrim(coalesce(p_note,''))) < 15 and cardinality(v_urls)=0 then
      raise exception 'Add a completion note (at least 15 characters) or an evidence link';
    end if;
    v_next:='submitted_for_review';
  else
    raise exception 'That action is not available for the current task status';
  end if;

  update public.work_assignments
  set status=v_next,
      worker_note=case
        when p_action in ('accept','start','decline')
          then nullif(left(btrim(coalesce(p_note,'')),2000),'')
        else worker_note end,
      completion_note=case when p_action='submit'
        then nullif(left(btrim(coalesce(p_note,'')),2000),'')
        else completion_note end,
      evidence_urls=case when p_action='submit' then v_urls else evidence_urls end,
      updated_at=now()
  where id=p_assignment_id
  returning * into v_row;

  insert into public.work_events(assignment_id,actor_id,action,note)
  values (
    p_assignment_id,
    v_user,
    case when p_action='decline' then 'declined' else v_next end,
    nullif(left(btrim(coalesce(p_note,'')),1000),'')
  );
  return v_row;
end;
$$;

revoke all on function public.janwatch_worker_update_assignment(uuid,text,text,text[]) from public, anon;
grant execute on function public.janwatch_worker_update_assignment(uuid,text,text,text[]) to authenticated;

notify pgrst, 'reload schema';
