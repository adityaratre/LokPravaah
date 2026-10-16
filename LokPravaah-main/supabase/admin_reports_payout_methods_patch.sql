-- LokPravaah report-review and payout-method repair.
-- Run once in Supabase SQL Editor after the existing V4 platform migration.
-- Safe to re-run. Cash/gift-card delivery remains manual; no payment is sent by this migration.

-- Ensure privileged reviewers can read all report rows and their status timeline.
drop policy if exists "reports read public or own" on public.reports;
create policy "reports read public or own" on public.reports
  for select to anon, authenticated
  using (visibility = 'public' or reporter_id = auth.uid() or public.is_janwatch_admin());

drop policy if exists "events read visible reports" on public.report_events;
create policy "events read visible reports" on public.report_events
  for select to authenticated
  using (exists (
    select 1 from public.reports r where r.id = report_id
      and (r.visibility = 'public' or r.reporter_id = auth.uid() or public.is_janwatch_admin())
  ));

-- Private evidence stays private, but the owner and authorised report reviewers can open a short-lived signed URL.
drop policy if exists "evidence read own or admin" on storage.objects;
create policy "evidence read own or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'citizen-evidence' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_janwatch_admin()));

-- Configure which payout methods citizens can request.
alter table public.reward_settings
  add column if not exists enabled_payout_methods text[] not null default array['UPI']::text[];
update public.reward_settings
  set enabled_payout_methods = array['UPI']::text[]
  where enabled_payout_methods is null or cardinality(enabled_payout_methods) = 0;
alter table public.reward_settings
  drop constraint if exists reward_settings_enabled_payout_methods_check;
alter table public.reward_settings
  add constraint reward_settings_enabled_payout_methods_check
  check (enabled_payout_methods <@ array['UPI','Bank transfer','Gift card']::text[]);

alter table public.reward_withdrawals
  drop constraint if exists reward_withdrawals_payout_method_check;
alter table public.reward_withdrawals
  add constraint reward_withdrawals_payout_method_check
  check (payout_method in ('UPI','Bank transfer','Gift card'));

-- Replace the UPI-only request function with a server-validated method-aware function.
create or replace function public.janwatch_request_reward_withdrawal(p_points integer, p_method text, p_destination text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_cash_enabled boolean;
  v_rate numeric(12,2);
  v_min integer;
  v_methods text[];
  v_balance bigint;
  v_id uuid;
  v_destination text := btrim(coalesce(p_destination,''));
  v_method text := btrim(coalesce(p_method,''));
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select enabled, cash_redemption_enabled, points_per_rupee, min_withdrawal_points, enabled_payout_methods
    into v_enabled, v_cash_enabled, v_rate, v_min, v_methods
    from public.reward_settings where id = true;
  if coalesce(v_enabled,false) is not true then raise exception 'Rewards are currently disabled'; end if;
  if coalesce(v_cash_enabled,false) is not true then raise exception 'Withdrawals are not enabled yet'; end if;
  if not exists (select 1 from public.app_feature_flags where flag_key = 'rewards' and enabled) then raise exception 'Reward feature is disabled'; end if;
  if v_method not in ('UPI','Bank transfer','Gift card') or not (v_method = any(coalesce(v_methods,array['UPI']::text[]))) then
    raise exception 'This payout method is not currently available';
  end if;
  if char_length(v_destination) < 5 or char_length(v_destination) > 120 then raise exception 'Payout details are incomplete'; end if;
  if v_method = 'UPI' and v_destination !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$' then
    raise exception 'Enter a valid UPI ID';
  elsif v_method = 'Bank transfer' and v_destination !~* '^Name: [^;]{2,50}; Account: [0-9]{8,18}; IFSC: [A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'Enter a valid account name, account number and IFSC code';
  elsif v_method = 'Gift card' and v_destination !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and v_destination !~ '^\+?[0-9 ()-]{10,18}$' then
    raise exception 'Enter an email address or mobile number for delivery';
  end if;
  if p_points is null or p_points < v_min then raise exception 'Requested points are below the minimum withdrawal threshold'; end if;
  select coalesce(sum(delta_points),0) into v_balance from public.reward_ledger where user_id = v_user;
  v_balance := v_balance - coalesce((select sum(points_requested) from public.reward_withdrawals where user_id = v_user and status in ('pending','approved','paid')),0);
  if p_points > v_balance then raise exception 'Insufficient available reward points'; end if;
  insert into public.reward_withdrawals(user_id,points_requested,amount_inr,payout_method,payout_destination)
    values (v_user,p_points,round(p_points / v_rate,2),v_method,v_destination)
    returning id into v_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values (v_user,'reward_withdrawal_requested','reward_withdrawal',v_id::text,jsonb_build_object('points',p_points,'method',v_method));
  return v_id;
end;
$$;
revoke all on function public.janwatch_request_reward_withdrawal(integer,text,text) from public, anon;
grant execute on function public.janwatch_request_reward_withdrawal(integer,text,text) to authenticated;

-- Audited admin point grants/deductions. Deductions cannot consume points reserved by payout requests.
create or replace function public.janwatch_admin_adjust_reward_points(p_target_user_id uuid, p_delta_points integer, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_available bigint;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.is_janwatch_admin() then raise exception 'Administrator permission required'; end if;
  if p_target_user_id is null or not exists (select 1 from auth.users where id = p_target_user_id) then raise exception 'Target account not found'; end if;
  if p_delta_points is null or p_delta_points = 0 or abs(p_delta_points) > 1000000 then raise exception 'Point adjustment is outside the allowed range'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 400 then raise exception 'Provide a reason between 3 and 400 characters'; end if;
  perform pg_advisory_xact_lock(hashtext(p_target_user_id::text));
  if p_delta_points > 0 then
    if not exists (select 1 from public.reward_settings where id = true and enabled) then raise exception 'Rewards are currently disabled'; end if;
    if not exists (select 1 from public.app_feature_flags where flag_key='rewards' and enabled) then raise exception 'Reward feature is disabled'; end if;
  else
    select coalesce(sum(delta_points),0) - coalesce((
      select sum(points_requested) from public.reward_withdrawals
      where user_id = p_target_user_id and status in ('pending','approved','paid')
    ),0) into v_available
    from public.reward_ledger where user_id = p_target_user_id;
    if abs(p_delta_points)::bigint > greatest(v_available,0) then raise exception 'Deduction exceeds the account available points'; end if;
  end if;
  insert into public.reward_ledger(user_id,delta_points,reason,created_by)
    values (p_target_user_id,p_delta_points,v_reason,auth.uid());
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values (auth.uid(),case when p_delta_points > 0 then 'admin_points_granted' else 'admin_points_deducted' end,
      'user',p_target_user_id::text,jsonb_build_object('delta_points',p_delta_points,'reason',v_reason));
end;
$$;
revoke all on function public.janwatch_admin_adjust_reward_points(uuid,integer,text) from public, anon;
grant execute on function public.janwatch_admin_adjust_reward_points(uuid,integer,text) to authenticated;

-- Keep the audited settings record aware of enabled payout options.
create or replace function public.janwatch_log_reward_settings_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'reward_settings_changed', 'reward_settings', 'true',
    jsonb_build_object(
      'enabled', new.enabled,
      'cash_redemption_enabled', new.cash_redemption_enabled,
      'enabled_payout_methods', new.enabled_payout_methods,
      'points_per_rupee', new.points_per_rupee,
      'min_withdrawal_points', new.min_withdrawal_points,
      'auto_reward_on_verified', new.auto_reward_on_verified,
      'points_for_verified_report', new.points_for_verified_report,
      'auto_reward_on_resolved', new.auto_reward_on_resolved,
      'points_for_resolved_report', new.points_for_resolved_report
    ));
  return new;
end;
$$;
drop trigger if exists janwatch_reward_settings_audit on public.reward_settings;
create trigger janwatch_reward_settings_audit after update on public.reward_settings
  for each row execute function public.janwatch_log_reward_settings_change();

notify pgrst, 'reload schema';
