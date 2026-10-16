-- Run in Supabase SQL Editor for the existing LokPravaah project.
-- This repairs a missing singleton settings row only; it does not erase existing settings.
-- Older databases may not have the payout-method column yet, so add it before referencing it.
alter table public.reward_settings
  add column if not exists enabled_payout_methods text[] not null default array['UPI']::text[];

update public.reward_settings
set enabled_payout_methods = array['UPI']::text[]
where enabled_payout_methods is null or cardinality(enabled_payout_methods) = 0;

-- If the table itself is missing, apply the project's v4_platform_migration.sql first.
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
