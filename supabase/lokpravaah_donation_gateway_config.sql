-- LokPravaah public donation gateway connection for the current Render deployment.
-- Safe to re-run. This deliberately keeps online payments DISABLED until the real
-- receiving UPI VPA and signed webhook have been configured and tested.

insert into public.donation_settings (
  id,
  donations_enabled,
  payment_gateway_enabled,
  gateway_portal_url,
  gateway_api_url,
  gateway_merchant_key,
  updated_at
) values (
  true,
  true,
  false,
  'https://lokpravaah-upi.onrender.com',
  'https://lokpravaah-upi.onrender.com',
  '00000000-0000-0000-0000-000000000001',
  now()
)
on conflict (id) do update set
  donations_enabled = true,
  payment_gateway_enabled = false,
  gateway_portal_url = excluded.gateway_portal_url,
  gateway_api_url = excluded.gateway_api_url,
  gateway_merchant_key = excluded.gateway_merchant_key,
  updated_at = now();

-- Do not run the enabling statement below until the receiving VPA is real,
-- the webhook secret matches on Render and Supabase, and an end-to-end test passes.
-- update public.donation_settings set payment_gateway_enabled = true, updated_at = now() where id = true;
