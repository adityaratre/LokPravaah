-- Shared, exact public dashboard stats and direct-UPI checkout configuration.
-- Payment confirmation remains manual-review-only. This exposes only the receiving
-- UPI address and public campaign limits needed to initiate a user-approved payment.

create or replace function public.janwatch_get_public_report_stats()
returns jsonb
language sql
stable
security definer
set search_path = 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'total', count(*)::bigint,
    'active', count(*) filter (where status::text in ('submitted','under_review','verified','in_progress'))::bigint,
    'resolved', count(*) filter (where status::text = 'resolved')::bigint,
    'refreshed_at', now()
  )
  from public.reports
  where visibility::text = 'public';
$function$;

grant execute on function public.janwatch_get_public_report_stats() to anon, authenticated;

create or replace function public.janwatch_get_public_donation_checkout_config()
returns jsonb
language sql
stable
security definer
set search_path = 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'donations_enabled', d.donations_enabled,
    'payment_gateway_enabled', d.payment_gateway_enabled,
    'upi_vpa', coalesce(nullif(btrim(r.receiving_vpa), ''), nullif(btrim(d.receiving_upi_vpa), ''), nullif(btrim(d.upi_vpa), '')),
    'upi_payee_name', coalesce(nullif(btrim(r.payee_name), ''), nullif(btrim(d.receiving_payee_name), ''), nullif(btrim(d.upi_payee_name), ''), 'LokPravaah'),
    'min_amount_paise', d.min_amount_paise,
    'max_amount_paise', d.max_amount_paise,
    'suggested_amounts', d.suggested_amounts,
    'campaign_title', d.campaign_title,
    'campaign_description', d.campaign_description,
    'campaign_goal_paise', d.campaign_goal_paise,
    'refreshed_at', now()
  )
  from public.donation_settings d
  left join public.upi_gateway_receiver_settings r on r.id = true
  where d.id = true;
$function$;

grant execute on function public.janwatch_get_public_donation_checkout_config() to anon, authenticated;
