-- LokPravaah incremental repair: missing admin manual reward adjustment RPC.
-- Apply after supabase/v4_platform_migration.sql and the core worker/blog migration.
-- This does not rewrite existing ledger rows or withdrawal requests.

CREATE OR REPLACE FUNCTION public.janwatch_admin_adjust_reward_points(
  p_target_user_id uuid,
  p_delta_points integer,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $adjust_reward_fn$
DECLARE
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance bigint;
  v_reserved bigint;
  v_available bigint;
  v_ledger_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF coalesce(v_role, '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Administrator permission required';
  END IF;
  IF p_target_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;
  IF p_delta_points IS NULL OR p_delta_points = 0 OR abs(p_delta_points::bigint) > 1000000 THEN
    RAISE EXCEPTION 'Point adjustment must be between -1,000,000 and 1,000,000 and cannot be zero';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 400 THEN
    RAISE EXCEPTION 'Enter a reason between 3 and 400 characters';
  END IF;

  -- Share the per-user lock with withdrawal requests to avoid concurrent overdraws.
  PERFORM pg_advisory_xact_lock(hashtext(p_target_user_id::text));

  IF p_delta_points > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.reward_settings WHERE id = true AND enabled) THEN
      RAISE EXCEPTION 'Enable the reward programme before granting points';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.app_feature_flags WHERE flag_key = 'rewards' AND enabled) THEN
      RAISE EXCEPTION 'Reward feature is disabled';
    END IF;
  END IF;

  SELECT coalesce(sum(delta_points), 0)::bigint INTO v_balance
  FROM public.reward_ledger WHERE user_id = p_target_user_id;
  SELECT coalesce(sum(points_requested), 0)::bigint INTO v_reserved
  FROM public.reward_withdrawals
  WHERE user_id = p_target_user_id AND status IN ('pending', 'approved', 'paid');
  v_available := v_balance - v_reserved;

  IF p_delta_points < 0 AND abs(p_delta_points::bigint) > greatest(0, v_available) THEN
    RAISE EXCEPTION 'Cannot deduct more points than the account has available after reserved withdrawals';
  END IF;

  INSERT INTO public.reward_ledger(user_id, delta_points, reason, source_report_id, created_by)
  VALUES (p_target_user_id, p_delta_points, v_reason, NULL, auth.uid())
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, metadata)
  VALUES (
    auth.uid(), 'reward_points_adjusted', 'reward_ledger', v_ledger_id::text,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'delta_points', p_delta_points,
      'reason', v_reason,
      'available_before', v_available,
      'available_after', v_available + p_delta_points
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'adjustment_id', v_ledger_id,
    'target_user_id', p_target_user_id,
    'delta_points', p_delta_points,
    'available_points', v_available + p_delta_points
  );
END;
$adjust_reward_fn$;

REVOKE ALL ON FUNCTION public.janwatch_admin_adjust_reward_points(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_adjust_reward_points(uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
