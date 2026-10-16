-- Run in Supabase SQL Editor for the existing LokPravaah project.
-- Adds the payout-method column when an older schema lacks it, and inserts a default settings row only if missing.
-- If the table itself is missing, apply the project's v4_platform_migration.sql first.
-- Older databases may not yet have this newer payout-method column. Add it BEFORE
-- the final SELECT so the whole script works on both older and newer installations.
alter table public.reward_settings
  add column if not exists enabled_payout_methods text[] not null default array['UPI']::text[];
alter table public.reward_settings
  alter column enabled_payout_methods set default array['UPI']::text[];

-- Keep only the methods supported by the current UI; default to UPI if the old
-- value was absent, empty, null-only or contained legacy method names.
update public.reward_settings rs
  set enabled_payout_methods = coalesce((
    select array_agg(u.method order by u.ordinality)
    from unnest(coalesce(rs.enabled_payout_methods, array[]::text[])) with ordinality as u(method, ordinality)
    where u.method = any(array['UPI','Bank transfer','Gift card']::text[])
  ), array['UPI']::text[]);

alter table public.reward_settings
  alter column enabled_payout_methods set not null;

alter table public.reward_settings
  drop constraint if exists reward_settings_enabled_payout_methods_check;
alter table public.reward_settings
  add constraint reward_settings_enabled_payout_methods_check
  check (enabled_payout_methods <@ array['UPI','Bank transfer','Gift card']::text[]);

insert into public.reward_settings (
  id, enabled, cash_redemption_enabled, points_per_rupee,
  min_withdrawal_points, auto_reward_on_verified, points_for_verified_report,
  auto_reward_on_resolved, points_for_resolved_report
)
values (true, true, false, 100, 10000, true, 25, true, 75)
on conflict (id) do nothing;

-- Confirm that exactly one settings row exists and inspect current values.
select id, enabled, cash_redemption_enabled, points_per_rupee,
       min_withdrawal_points, enabled_payout_methods,
       auto_reward_on_verified, points_for_verified_report,
       auto_reward_on_resolved, points_for_resolved_report
from public.reward_settings
where id = true;
