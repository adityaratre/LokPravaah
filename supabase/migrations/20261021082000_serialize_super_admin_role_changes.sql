-- Serialize privileged role changes so two concurrent requests cannot both
-- observe themselves as the last super-admin and demote each other.
create or replace function public.janwatch_admin_set_role(p_target_user_id uuid, p_target_role text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_current text;
  v_super_count integer;
  v_city text;
  v_ward text;
begin
  if not public.is_janwatch_super_admin() then
    raise exception 'Super administrator permission required';
  end if;
  perform pg_advisory_xact_lock(714293, 1001);
  if p_target_user_id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if p_target_role is not null and p_target_role not in ('worker','moderator','admin','super_admin') then
    raise exception 'Unsupported role';
  end if;
  select role into v_current from public.user_roles where user_id = p_target_user_id for update;
  if v_current = 'super_admin' and coalesce(p_target_role, 'citizen') <> 'super_admin' then
    select count(*) into v_super_count from public.user_roles where role = 'super_admin';
    if v_super_count <= 1 then raise exception 'Cannot remove the last super administrator'; end if;
  end if;
  if p_target_role is null or p_target_role = 'citizen' then
    delete from public.user_roles where user_id = p_target_user_id;
    update public.worker_profiles set status = 'suspended', available = false, updated_at = now()
    where user_id = p_target_user_id and status = 'active';
  else
    insert into public.user_roles(user_id, role, assigned_by) values (p_target_user_id, p_target_role, auth.uid())
    on conflict (user_id) do update set role = excluded.role, assigned_by = auth.uid();
    if p_target_role = 'worker' then
      select
        case when char_length(btrim(coalesce(city, ''))) between 2 and 80 then btrim(city) else 'Unspecified city' end,
        case when char_length(btrim(coalesce(ward, ''))) between 1 and 80 then btrim(ward) else 'Unspecified area' end
      into v_city, v_ward from public.profiles where id = p_target_user_id;
      v_city := coalesce(v_city, 'Unspecified city');
      v_ward := coalesce(v_ward, 'Unspecified area');
      insert into public.worker_profiles(user_id, status, city, ward, skills, motivation, max_active_tasks, available, approved_by, approved_at)
      values (p_target_user_id, 'active', v_city, v_ward, '{}', 'Directly assigned by a super administrator', 3, true, auth.uid(), now())
      on conflict (user_id) do update set status = 'active', available = true, approved_by = auth.uid(), approved_at = now(), updated_at = now();
    elsif v_current = 'worker' then
      update public.worker_profiles set status = 'suspended', available = false, updated_at = now()
      where user_id = p_target_user_id and status = 'active';
    end if;
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'user_role_changed', 'user', p_target_user_id::text,
    jsonb_build_object('old_role', coalesce(v_current, 'citizen'), 'new_role', coalesce(p_target_role, 'citizen')));
end;
$function$;
revoke all on function public.janwatch_admin_set_role(uuid, text) from public, anon;
grant execute on function public.janwatch_admin_set_role(uuid, text) to authenticated;
notify pgrst, 'reload schema';
