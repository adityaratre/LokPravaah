-- LokPravaah final UPI reliability + manual donation verification migration.
-- Apply AFTER supabase/lokpravaah_donations.sql, supabase/lokpravaah_cloudflare_gateway.sql,
-- and supabase/lokpravaah_support_and_concurrency_fix.sql. Take a backup first.
-- Browser clients never mark payments successful. Admin confirms only after bank-credit evidence is checked.

-- CRITICAL: remove legacy merchant-wide unique slot. It silently makes independent concurrent checkouts fail.
drop index if exists public.upi_gateway_single_active_slot_uq;

alter table public.donation_settings add column if not exists payment_session_minutes integer not null default 15;
alter table public.donation_settings add column if not exists receiving_upi_vpa text;
alter table public.donation_settings add column if not exists receiving_payee_name text;
do $$ begin
  alter table public.donation_settings add constraint donation_settings_session_minutes_check check (payment_session_minutes between 5 and 30);
exception when duplicate_object then null; end $$;

create or replace function public.upi_gateway_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.upi_gateway_payments
    set status = 'EXPIRED', updated_at = now(), queue_position = 0
    where status = 'ACTIVE' and expires_at is not null and expires_at <= now();
  -- Legacy queued sessions are promoted independently; there is no global single-payment lock.
  update public.upi_gateway_payments p
    set status = 'ACTIVE', queue_position = 0,
        expires_at = now() + make_interval(mins => greatest(5, least(30, p.session_minutes))),
        updated_at = now()
    where p.status = 'QUEUED';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.upi_gateway_create_payment(
  p_payment_id uuid, p_order_id text, p_amount_paise bigint, p_merchant_id text,
  p_idempotency_key text default null, p_session_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer := greatest(5, least(30, coalesce(p_session_minutes,15)));
begin
  -- Lock only the specific donation intent, not the entire merchant.
  select * into v_donation from public.donation_intents where order_id = p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then raise exception 'DONATION_AMOUNT_MISMATCH'; end if;
  select * into v_existing from public.upi_gateway_payments where order_id = p_order_id limit 1;
  if found then return jsonb_build_object(
    'paymentId',v_existing.id,'orderId',v_existing.order_id,
    'amount',to_char(v_existing.amount_paise / 100.0,'FM999999990.00'),
    'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
    'status',v_existing.status,'queuePosition',v_existing.queue_position,
    'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at); end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_merchant_id <> '00000000-0000-0000-0000-000000000001' then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;
  insert into public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,created_at,updated_at
  ) values (p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),now(),now()) returning * into v_created;
  return jsonb_build_object('paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise / 100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,'completedAt',v_created.completed_at);
end; $$;


alter table public.donation_intents add column if not exists admin_removed boolean not null default false;
create index if not exists donation_intents_public_success_idx on public.donation_intents(verified_at desc) where status='succeeded' and admin_hidden=false and admin_removed=false;

create table if not exists public.donation_manual_review_claims (
  id uuid primary key default gen_random_uuid(),
  donation_intent_id uuid not null unique references public.donation_intents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  screenshot_path text not null,
  claimed_utr text check (claimed_utr is null or char_length(claimed_utr) between 6 and 80),
  claimed_amount_paise bigint check (claimed_amount_paise is null or claimed_amount_paise between 100 and 10000000),
  payment_timestamp timestamptz,
  user_note text check (user_note is null or char_length(user_note) <= 2000),
  status text not null default 'pending_review' check (status in ('pending_review','confirmed','rejected')),
  admin_review_note text check (admin_review_note is null or char_length(admin_review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists donation_manual_review_queue_idx on public.donation_manual_review_claims(status,created_at desc);
alter table public.donation_manual_review_claims enable row level security;
revoke all on public.donation_manual_review_claims from public, anon, authenticated;
grant select on public.donation_manual_review_claims to authenticated;
grant all on public.donation_manual_review_claims to service_role;
drop policy if exists donation_manual_claim_read_own_or_admin on public.donation_manual_review_claims;
create policy donation_manual_claim_read_own_or_admin on public.donation_manual_review_claims for select to authenticated
  using (user_id=auth.uid() or public.is_janwatch_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('donation-payment-evidence','donation-payment-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists donation_evidence_upload_own on storage.objects;
create policy donation_evidence_upload_own on storage.objects for insert to authenticated with check (
  bucket_id='donation-payment-evidence' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists donation_evidence_read_own_admin on storage.objects;
create policy donation_evidence_read_own_admin on storage.objects for select to authenticated using (
  bucket_id='donation-payment-evidence' and (
    (storage.foldername(name))[1]=auth.uid()::text or public.is_janwatch_admin()
  )
);

create table if not exists public.donation_admin_review_audit (
  id uuid primary key default gen_random_uuid(),
  donation_intent_id uuid references public.donation_intents(id) on delete set null,
  claim_id uuid references public.donation_manual_review_claims(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.donation_admin_review_audit enable row level security;
revoke all on public.donation_admin_review_audit from public, anon, authenticated;
grant all on public.donation_admin_review_audit to service_role;
drop policy if exists donation_admin_review_audit_read on public.donation_admin_review_audit;
create policy donation_admin_review_audit_read on public.donation_admin_review_audit for select to authenticated using (public.is_janwatch_admin());


create or replace function public.janwatch_get_public_donation_data()
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_settings public.donation_settings%rowtype;
  v_total bigint := 0;
  v_count bigint := 0;
  v_top jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
begin
  select * into v_settings from public.donation_settings where id = true;
  if not found then
    return jsonb_build_object('settings', jsonb_build_object('donations_enabled', true, 'payment_gateway_enabled', true, 'gateway_portal_url', null, 'gateway_api_url', null, 'gateway_merchant_key', null, 'leaderboard_enabled', true, 'show_public_total', true, 'show_goal_progress', true, 'show_recent_donations', true, 'show_donor_messages', true, 'campaign_title', 'Build a stronger civic community', 'campaign_description', 'Your contribution helps keep LokPravaah available, accessible and improving.', 'campaign_goal_paise', 5000000, 'payment_session_minutes', 15, 'min_amount_paise', 100, 'max_amount_paise', 10000000, 'suggested_amounts', '[51,101,251,501,1001,2100]'::jsonb, 'thank_you_title', 'Thank you for backing civic action', 'thank_you_message', 'Your support helps us keep improving LokPravaah for the community.'), 'total_raised_paise', 0, 'successful_donations', 0, 'top_donors', '[]'::jsonb, 'recent_donations', '[]'::jsonb);
  end if;

  select coalesce(sum(amount_paise), 0), count(*) into v_total, v_count
  from public.donation_intents where status = 'succeeded' and admin_removed = false;

  if v_settings.leaderboard_enabled then
    with grouped as (
      select
        coalesce('user:' || donor_user_id::text, 'guest:' || lower(coalesce(nullif(btrim(donor_email), ''), nullif(btrim(donor_name), ''), order_id))) as donor_key,
        max(coalesce(nullif(btrim(donor_name), ''), 'Community supporter')) as donor_name,
        sum(amount_paise)::bigint as total_paise,
        count(*)::bigint as donations_count
      from public.donation_intents
      where status = 'succeeded' and admin_removed = false and is_anonymous = false and show_on_leaderboard = true and admin_hidden = false
      group by 1
    ), ranked as (
      select row_number() over (order by total_paise desc, donations_count desc, donor_name asc) as rank,
             donor_name, total_paise, donations_count
      from grouped
    )
    select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'donor_name', donor_name, 'total_paise', total_paise, 'donations_count', donations_count) order by rank), '[]'::jsonb)
    into v_top from (select * from ranked where rank <= 10) r;
  end if;

  if v_settings.show_recent_donations then
    select coalesce(jsonb_agg(jsonb_build_object(
      'display_name', case when is_anonymous or admin_hidden or not show_on_leaderboard then 'Anonymous supporter' else coalesce(nullif(btrim(donor_name), ''), 'Community supporter') end,
      'amount_paise', amount_paise,
      'verified_at', verified_at,
      'message', case when v_settings.show_donor_messages and not is_anonymous and not admin_hidden and show_on_leaderboard and show_message_publicly then nullif(btrim(message), '') else null end
    ) order by verified_at desc), '[]'::jsonb)
    into v_recent
    from (select * from public.donation_intents where status = 'succeeded' and not admin_hidden and not admin_removed order by verified_at desc limit 8) recent;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'donations_enabled', v_settings.donations_enabled,
      'payment_gateway_enabled', v_settings.payment_gateway_enabled,
      'gateway_portal_url', v_settings.gateway_portal_url,
      'gateway_api_url', v_settings.gateway_api_url,
      'gateway_merchant_key', v_settings.gateway_merchant_key,
      'leaderboard_enabled', v_settings.leaderboard_enabled,
      'show_public_total', v_settings.show_public_total,
      'show_goal_progress', v_settings.show_goal_progress,
      'show_recent_donations', v_settings.show_recent_donations,
      'show_donor_messages', v_settings.show_donor_messages,
      'campaign_title', v_settings.campaign_title,
      'campaign_description', v_settings.campaign_description,
      'campaign_goal_paise', v_settings.campaign_goal_paise,
      'payment_session_minutes', v_settings.payment_session_minutes,
      'min_amount_paise', v_settings.min_amount_paise,
      'max_amount_paise', v_settings.max_amount_paise,
      'suggested_amounts', v_settings.suggested_amounts,
      'thank_you_title', v_settings.thank_you_title,
      'thank_you_message', v_settings.thank_you_message
    ),
    'total_raised_paise', v_total,
    'successful_donations', v_count,
    'top_donors', v_top,
    'recent_donations', v_recent,
    'refreshed_at', now()
  );
end;
$$;

create or replace function public.janwatch_admin_get_donation_data()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_role text; v_settings jsonb; v_donations jsonb; v_requests jsonb; v_claims jsonb;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  select to_jsonb(s) - 'id' into v_settings from public.donation_settings s where id = true;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'order_id', d.order_id, 'amount_paise', d.amount_paise, 'currency', d.currency,
    'donor_user_id', d.donor_user_id, 'donor_name', d.donor_name, 'donor_email', d.donor_email,
    'is_anonymous', d.is_anonymous, 'show_on_leaderboard', d.show_on_leaderboard, 'show_message_publicly', d.show_message_publicly, 'admin_hidden', d.admin_hidden, 'admin_removed', d.admin_removed,
    'message', d.message, 'status', d.status, 'utr', d.utr, 'gateway_payment_id', d.gateway_payment_id,
    'created_at', d.created_at, 'verified_at', d.verified_at
  ) order by d.created_at desc), '[]'::jsonb) into v_donations from (select * from public.donation_intents order by created_at desc limit 150) d;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'requested_by', r.requested_by, 'changes', r.changes, 'status', r.status, 'review_note', r.review_note, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into v_requests from (select * from public.donation_settings_change_requests order by created_at desc limit 100) r;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'donation_intent_id', c.donation_intent_id, 'order_id', d.order_id,
    'donation_amount_paise', d.amount_paise, 'donation_status', d.status,
    'donor_name', d.donor_name, 'donor_email', d.donor_email,
    'user_id', c.user_id, 'claimed_utr', c.claimed_utr, 'claimed_amount_paise', c.claimed_amount_paise,
    'payment_timestamp', c.payment_timestamp, 'user_note', c.user_note, 'screenshot_path', c.screenshot_path,
    'status', c.status, 'admin_review_note', c.admin_review_note, 'reviewed_by', c.reviewed_by,
    'reviewed_at', c.reviewed_at, 'created_at', c.created_at
  ) order by c.created_at desc), '[]'::jsonb)
  into v_claims
  from (select * from public.donation_manual_review_claims order by created_at desc limit 150) c
  join public.donation_intents d on d.id = c.donation_intent_id;
  return jsonb_build_object('role', v_role, 'settings', coalesce(v_settings, '{}'::jsonb), 'donations', v_donations, 'change_requests', v_requests, 'manual_reviews', v_claims);
end;
$$;

create or replace function public.janwatch_admin_update_donation_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_role text;
  v_current public.donation_settings%rowtype;
  v_major jsonb := '{}'::jsonb;
  v_request_id uuid;
  v_suggested jsonb;
  v_min bigint;
  v_max bigint;
  v_goal bigint;
  v_session_minutes integer;
  v_receiving_upi_vpa text;
  v_receiving_payee_name text;
  v_title text;
  v_description text;
  v_thanks_title text;
  v_thanks_message text;
  v_donations_enabled boolean;
  v_gateway_enabled boolean;
  v_gateway_portal_url text;
  v_gateway_api_url text;
  v_gateway_merchant_key text;
  v_leaderboard_enabled boolean;
  v_show_total boolean;
  v_show_goal boolean;
  v_show_recent boolean;
  v_show_messages boolean;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  select * into v_current from public.donation_settings where id = true for update;
  if not found then raise exception 'Donation settings are not installed'; end if;

  v_min := coalesce(nullif(p_settings->>'min_amount_paise','')::bigint, v_current.min_amount_paise);
  v_max := coalesce(nullif(p_settings->>'max_amount_paise','')::bigint, v_current.max_amount_paise);
  v_goal := coalesce(nullif(p_settings->>'campaign_goal_paise','')::bigint, v_current.campaign_goal_paise);
  v_session_minutes := coalesce(nullif(p_settings->>'payment_session_minutes','')::integer, v_current.payment_session_minutes);
  v_receiving_upi_vpa := case when p_settings ? 'receiving_upi_vpa' then nullif(btrim(p_settings->>'receiving_upi_vpa'), '') else v_current.receiving_upi_vpa end;
  v_receiving_payee_name := case when p_settings ? 'receiving_payee_name' then nullif(btrim(p_settings->>'receiving_payee_name'), '') else v_current.receiving_payee_name end;
  v_suggested := coalesce(p_settings->'suggested_amounts', v_current.suggested_amounts);
  v_title := coalesce(nullif(btrim(p_settings->>'campaign_title'), ''), v_current.campaign_title);
  v_description := coalesce(nullif(btrim(p_settings->>'campaign_description'), ''), v_current.campaign_description);
  v_thanks_title := coalesce(nullif(btrim(p_settings->>'thank_you_title'), ''), v_current.thank_you_title);
  v_thanks_message := coalesce(nullif(btrim(p_settings->>'thank_you_message'), ''), v_current.thank_you_message);
  v_donations_enabled := coalesce(nullif(p_settings->>'donations_enabled','')::boolean, v_current.donations_enabled);
  v_gateway_enabled := coalesce(nullif(p_settings->>'payment_gateway_enabled','')::boolean, v_current.payment_gateway_enabled);
  v_gateway_portal_url := case when p_settings ? 'gateway_portal_url' then nullif(btrim(p_settings->>'gateway_portal_url'), '') else v_current.gateway_portal_url end;
  v_gateway_api_url := case when p_settings ? 'gateway_api_url' then nullif(btrim(p_settings->>'gateway_api_url'), '') else v_current.gateway_api_url end;
  v_gateway_merchant_key := case when p_settings ? 'gateway_merchant_key' then nullif(btrim(p_settings->>'gateway_merchant_key'), '') else v_current.gateway_merchant_key end;
  v_leaderboard_enabled := coalesce(nullif(p_settings->>'leaderboard_enabled','')::boolean, v_current.leaderboard_enabled);
  v_show_total := coalesce(nullif(p_settings->>'show_public_total','')::boolean, v_current.show_public_total);
  v_show_goal := coalesce(nullif(p_settings->>'show_goal_progress','')::boolean, v_current.show_goal_progress);
  v_show_recent := coalesce(nullif(p_settings->>'show_recent_donations','')::boolean, v_current.show_recent_donations);
  v_show_messages := coalesce(nullif(p_settings->>'show_donor_messages','')::boolean, v_current.show_donor_messages);

  if v_min < 100 or v_min > 10000000 or v_max < v_min or v_max > 10000000 then raise exception 'Donation minimum/maximum amounts are invalid'; end if;
  if v_goal < 10000 or v_goal > 100000000000 then raise exception 'Campaign goal is outside the permitted range'; end if;
  if v_session_minutes < 5 or v_session_minutes > 30 then raise exception 'Payment session timer must be between 5 and 30 minutes'; end if;
  if v_receiving_upi_vpa is not null and v_receiving_upi_vpa !~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9._-]{2,64}$' then raise exception 'Receiving UPI ID/VPA format is invalid'; end if;
  if v_receiving_payee_name is not null and length(v_receiving_payee_name) > 99 then raise exception 'UPI payee name must be 99 characters or fewer'; end if;
  if (v_receiving_upi_vpa is null) <> (v_receiving_payee_name is null) then raise exception 'Configure both receiving UPI ID and payee name together, or leave both blank to use the server configuration'; end if;
  if v_gateway_portal_url is not null and v_gateway_portal_url !~* '^https://[^/[:space:]]+' then raise exception 'Checkout portal URL must be a valid HTTPS URL'; end if;
  if v_gateway_api_url is not null and v_gateway_api_url !~* '^https://[^/[:space:]]+' then raise exception 'Payment API URL must be a valid HTTPS URL'; end if;
  if length(coalesce(v_gateway_merchant_key,'')) > 200 then raise exception 'Public merchant key is too long'; end if;
  if jsonb_typeof(v_suggested) <> 'array' or jsonb_array_length(v_suggested) < 1 or jsonb_array_length(v_suggested) > 8 then raise exception 'Choose between 1 and 8 suggested donation amounts'; end if;
  if exists (select 1 from jsonb_array_elements(v_suggested) a where case when jsonb_typeof(a) = 'number' and (a #>> '{}') ~ '^[0-9]+$' then ((a #>> '{}')::numeric * 100 < v_min or (a #>> '{}')::numeric * 100 > v_max) else true end) then raise exception 'Every suggested amount must be a whole rupee between the configured minimum and maximum'; end if;
  if length(v_title) > 120 or length(v_description) > 600 or length(v_thanks_title) > 120 or length(v_thanks_message) > 600 then raise exception 'Campaign and thank-you text is too long'; end if;

  v_major := '{}'::jsonb;
  if v_donations_enabled is distinct from v_current.donations_enabled then v_major := v_major || jsonb_build_object('donations_enabled', v_donations_enabled); end if;
  if v_gateway_enabled is distinct from v_current.payment_gateway_enabled then v_major := v_major || jsonb_build_object('payment_gateway_enabled', v_gateway_enabled); end if;
  if v_gateway_portal_url is distinct from v_current.gateway_portal_url then v_major := v_major || jsonb_build_object('gateway_portal_url', v_gateway_portal_url); end if;
  if v_gateway_api_url is distinct from v_current.gateway_api_url then v_major := v_major || jsonb_build_object('gateway_api_url', v_gateway_api_url); end if;
  if v_gateway_merchant_key is distinct from v_current.gateway_merchant_key then v_major := v_major || jsonb_build_object('gateway_merchant_key', v_gateway_merchant_key); end if;
  if v_min is distinct from v_current.min_amount_paise then v_major := v_major || jsonb_build_object('min_amount_paise', v_min); end if;
  if v_max is distinct from v_current.max_amount_paise then v_major := v_major || jsonb_build_object('max_amount_paise', v_max); end if;
  if v_goal is distinct from v_current.campaign_goal_paise then v_major := v_major || jsonb_build_object('campaign_goal_paise', v_goal); end if;
  if v_session_minutes is distinct from v_current.payment_session_minutes then v_major := v_major || jsonb_build_object('payment_session_minutes', v_session_minutes); end if;
  if v_receiving_upi_vpa is distinct from v_current.receiving_upi_vpa then v_major := v_major || jsonb_build_object('receiving_upi_vpa', v_receiving_upi_vpa); end if;
  if v_receiving_payee_name is distinct from v_current.receiving_payee_name then v_major := v_major || jsonb_build_object('receiving_payee_name', v_receiving_payee_name); end if;
  if v_suggested is distinct from v_current.suggested_amounts then v_major := v_major || jsonb_build_object('suggested_amounts', v_suggested); end if;

  -- Apply safe presentation settings in either role; queue major settings for a super admin if requested by a normal admin.
  update public.donation_settings set
    leaderboard_enabled = v_leaderboard_enabled,
    show_public_total = v_show_total,
    show_goal_progress = v_show_goal,
    show_recent_donations = v_show_recent,
    show_donor_messages = v_show_messages,
    campaign_title = v_title,
    campaign_description = v_description,
    thank_you_title = v_thanks_title,
    thank_you_message = v_thanks_message,
    updated_by = auth.uid(), updated_at = now()
  where id = true;

  if v_role = 'super_admin' then
    update public.donation_settings set donations_enabled = v_donations_enabled, payment_gateway_enabled = v_gateway_enabled,
      gateway_portal_url = v_gateway_portal_url, gateway_api_url = v_gateway_api_url, gateway_merchant_key = v_gateway_merchant_key,
      min_amount_paise = v_min, max_amount_paise = v_max, campaign_goal_paise = v_goal, suggested_amounts = v_suggested, payment_session_minutes = v_session_minutes, receiving_upi_vpa = v_receiving_upi_vpa, receiving_payee_name = v_receiving_payee_name,
      updated_by = auth.uid(), updated_at = now() where id = true;
    return jsonb_build_object('status','saved','message','Donation settings saved.');
  elsif v_major <> '{}'::jsonb then
    insert into public.donation_settings_change_requests(requested_by, changes) values (auth.uid(), v_major) returning id into v_request_id;
    return jsonb_build_object('status','pending_approval','request_id',v_request_id,'message','Presentation settings saved. Major changes are waiting for super-admin approval.');
  end if;
  return jsonb_build_object('status','saved','message','Donation presentation settings saved.');
end;
$$;

create or replace function public.janwatch_super_admin_review_donation_settings(p_request_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_request public.donation_settings_change_requests%rowtype; v_role text;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') <> 'super_admin' then raise exception 'Super administrator permission required'; end if;
  select * into v_request from public.donation_settings_change_requests where id = p_request_id for update;
  if not found then raise exception 'Change request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'This change request has already been reviewed'; end if;
  if p_approve then
    update public.donation_settings set
      donations_enabled = coalesce((v_request.changes->>'donations_enabled')::boolean, donations_enabled),
      payment_gateway_enabled = coalesce((v_request.changes->>'payment_gateway_enabled')::boolean, payment_gateway_enabled),
      gateway_portal_url = case when v_request.changes ? 'gateway_portal_url' then nullif(v_request.changes->>'gateway_portal_url','') else gateway_portal_url end,
      gateway_api_url = case when v_request.changes ? 'gateway_api_url' then nullif(v_request.changes->>'gateway_api_url','') else gateway_api_url end,
      gateway_merchant_key = case when v_request.changes ? 'gateway_merchant_key' then nullif(v_request.changes->>'gateway_merchant_key','') else gateway_merchant_key end,
      min_amount_paise = coalesce((v_request.changes->>'min_amount_paise')::bigint, min_amount_paise),
      max_amount_paise = coalesce((v_request.changes->>'max_amount_paise')::bigint, max_amount_paise),
      campaign_goal_paise = coalesce((v_request.changes->>'campaign_goal_paise')::bigint, campaign_goal_paise),
      suggested_amounts = coalesce(v_request.changes->'suggested_amounts', suggested_amounts),
      payment_session_minutes = coalesce((v_request.changes->>'payment_session_minutes')::integer, payment_session_minutes),
      receiving_upi_vpa = case when v_request.changes ? 'receiving_upi_vpa' then nullif(v_request.changes->>'receiving_upi_vpa','') else receiving_upi_vpa end,
      receiving_payee_name = case when v_request.changes ? 'receiving_payee_name' then nullif(v_request.changes->>'receiving_payee_name','') else receiving_payee_name end,
      updated_by = auth.uid(), updated_at = now()
    where id = true;
    update public.donation_settings_change_requests set status = 'approved', review_note = left(nullif(btrim(p_note),''),500), reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
    return jsonb_build_object('status','approved','message','Major donation settings change approved and applied.');
  end if;
  update public.donation_settings_change_requests set status = 'rejected', review_note = left(nullif(btrim(p_note),''),500), reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  return jsonb_build_object('status','rejected','message','Major donation settings change rejected.');
end;
$$;

create or replace function public.upi_gateway_prepare_observation(
  p_observation_id uuid,
  p_device_id text,
  p_amount_paise bigint,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.upi_gateway_devices%rowtype;
  v_existing public.upi_gateway_observations%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_observed timestamptz := coalesce(p_observed_at,now());
  v_candidate_count integer := 0;
begin
  -- No merchant-wide advisory lock: unrelated payment sessions must proceed independently.
  select * into v_device from public.upi_gateway_devices where id = p_device_id and is_active = true;
  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 or p_bank_reference_number is null or char_length(p_bank_reference_number) not between 6 and 80 then
    raise exception 'INVALID_OBSERVATION';
  end if;
  if abs(extract(epoch from (now() - v_observed))) > 600 then raise exception 'OBSERVATION_TIME_OUT_OF_RANGE'; end if;

  select * into v_existing from public.upi_gateway_observations where bank_reference_number = p_bank_reference_number;
  if found then
    if v_existing.matched_payment_id is null then
      return jsonb_build_object('matched',false,'duplicate',true,'status',v_existing.status,'reason','PREVIOUSLY_UNMATCHED_REQUIRES_MANUAL_REVIEW');
    end if;
    select * into v_payment from public.upi_gateway_payments where id = v_existing.matched_payment_id;
    return jsonb_build_object('matched',true,'duplicate',true,'status',v_payment.status,'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
  end if;

  insert into public.upi_gateway_observations(id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at)
    values(coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());

  -- Only match when exactly one payment of this amount is eligible for the bank's event time.
  -- EXPIRED records are considered only when the bank-observed time fell inside the original session window.
  select count(*)::integer into v_candidate_count from public.upi_gateway_payments p
    where p.merchant_id = v_device.merchant_id
      and p.status in ('ACTIVE','EXPIRED')
      and p.amount_paise = p_amount_paise
      and p.created_at <= v_observed
      and p.expires_at is not null and p.expires_at >= v_observed;

  if v_candidate_count = 0 then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','reason','NO_ELIGIBLE_SESSION');
  elsif v_candidate_count > 1 then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','reason','AMBIGUOUS_MATCH','candidates',v_candidate_count);
  end if;

  select * into v_payment from public.upi_gateway_payments p
    where p.merchant_id = v_device.merchant_id
      and p.status in ('ACTIVE','EXPIRED')
      and p.amount_paise = p_amount_paise
      and p.created_at <= v_observed
      and p.expires_at is not null and p.expires_at >= v_observed
    order by p.created_at desc limit 1 for update;
  if not found then return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','reason','SESSION_CHANGED_DURING_MATCH'); end if;

  update public.upi_gateway_payments set status='PROCESSING', queue_position=0, bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''), observed_at=v_observed, processing_started_at=now(), updated_at=now()
    where id=v_payment.id;
  update public.upi_gateway_observations set status='PROCESSING', matched_payment_id=v_payment.id
    where bank_reference_number=p_bank_reference_number;
  return jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING','paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
end;
$$;


create or replace function public.janwatch_submit_manual_donation_claim(
  p_order_id text, p_screenshot_path text, p_claimed_utr text default null,
  p_claimed_amount_paise bigint default null, p_payment_timestamp timestamptz default null,
  p_user_note text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,storage,pg_temp as $$
declare v_user uuid:=auth.uid(); v_donation public.donation_intents%rowtype; v_claim public.donation_manual_review_claims%rowtype;
begin
  if v_user is null then raise exception 'Sign in to submit a payment review'; end if;
  if p_order_id is null or length(p_order_id) < 8 or length(p_order_id) > 80 then raise exception 'Invalid donation reference'; end if;
  if p_screenshot_path is null or length(p_screenshot_path)>500 or split_part(p_screenshot_path,'/',1) <> v_user::text then raise exception 'Upload the screenshot to your own secure evidence folder'; end if;
  if p_claimed_utr is not null and (length(p_claimed_utr)<6 or length(p_claimed_utr)>80 or p_claimed_utr !~ '^[A-Za-z0-9_-]+$') then raise exception 'Enter a valid UPI/bank reference or leave it blank'; end if;
  if p_user_note is not null and length(p_user_note)>2000 then raise exception 'Review note is too long'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='donation-payment-evidence' and o.name=p_screenshot_path) then raise exception 'Payment screenshot was not found in secure storage'; end if;
  select * into v_donation from public.donation_intents where order_id=p_order_id for update;
  if not found then raise exception 'Donation reference not found'; end if;
  if v_donation.status='succeeded' then raise exception 'This donation is already verified; contact support if your account shows a different result'; end if;
  if v_donation.donor_user_id is not null and v_donation.donor_user_id<>v_user then raise exception 'This donation reference belongs to another account'; end if;
  insert into public.donation_manual_review_claims(donation_intent_id,user_id,screenshot_path,claimed_utr,claimed_amount_paise,payment_timestamp,user_note,status,admin_review_note,reviewed_by,reviewed_at,created_at,updated_at)
  values(v_donation.id,v_user,p_screenshot_path,nullif(btrim(p_claimed_utr),''),p_claimed_amount_paise,p_payment_timestamp,left(nullif(btrim(p_user_note),''),2000),'pending_review',null,null,null,now(),now())
  on conflict(donation_intent_id) do update set
    screenshot_path=excluded.screenshot_path, claimed_utr=excluded.claimed_utr,
    claimed_amount_paise=excluded.claimed_amount_paise, payment_timestamp=excluded.payment_timestamp,
    user_note=excluded.user_note, status='pending_review', admin_review_note=null, reviewed_by=null, reviewed_at=null, updated_at=now()
  where public.donation_manual_review_claims.user_id=v_user
  returning * into v_claim;
  if not found then raise exception 'A review claim already exists for this donation and another account'; end if;
  insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
    values(v_donation.id,v_claim.id,v_user,'user_submitted_manual_review',jsonb_build_object('order_id',p_order_id));
  return jsonb_build_object('submitted',true,'claim_id',v_claim.id,'status',v_claim.status,'message','Evidence sent for manual bank-statement review. This does not itself verify payment.');
end $$;
revoke all on function public.janwatch_submit_manual_donation_claim(text,text,text,bigint,timestamptz,text) from public,anon;
grant execute on function public.janwatch_submit_manual_donation_claim(text,text,text,bigint,timestamptz,text) to authenticated;

create or replace function public.janwatch_get_my_donation_claim_status(p_order_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_user uuid:=auth.uid(); v_claim public.donation_manual_review_claims%rowtype;
begin
  if v_user is null then raise exception 'Sign in to check a payment review'; end if;
  select c.* into v_claim
  from public.donation_manual_review_claims c
  join public.donation_intents d on d.id=c.donation_intent_id
  where d.order_id=p_order_id and c.user_id=v_user limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  return jsonb_build_object('found',true,'status',v_claim.status,'admin_review_note',v_claim.admin_review_note,'created_at',v_claim.created_at,'reviewed_at',v_claim.reviewed_at);
end $$;
revoke all on function public.janwatch_get_my_donation_claim_status(text) from public,anon;
grant execute on function public.janwatch_get_my_donation_claim_status(text) to authenticated;

create or replace function public.janwatch_admin_review_manual_donation(
  p_claim_id uuid, p_action text, p_note text default null, p_verified_utr text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_role text; v_claim public.donation_manual_review_claims%rowtype; v_donation public.donation_intents%rowtype; v_utr text:=nullif(btrim(p_verified_utr),'');
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_action not in ('confirm','reject') then raise exception 'Action must be confirm or reject'; end if;
  if p_note is not null and length(p_note)>1000 then raise exception 'Review note is too long'; end if;
  select * into v_claim from public.donation_manual_review_claims where id=p_claim_id for update;
  if not found then raise exception 'Manual review claim not found'; end if;
  select * into v_donation from public.donation_intents where id=v_claim.donation_intent_id for update;
  if not found then raise exception 'Donation record not found'; end if;
  if v_claim.status <> 'pending_review' then raise exception 'This claim has already been reviewed'; end if;
  if p_action='confirm' then
    if v_utr is null or length(v_utr)<6 or length(v_utr)>80 or v_utr !~ '^[A-Za-z0-9_-]+$' then raise exception 'Enter the actual bank UTR/reference after checking the receiving-bank transaction'; end if;
    if exists(select 1 from public.donation_intents where utr=v_utr and id<>v_donation.id) then raise exception 'This UTR is already attached to another donation'; end if;
    if v_donation.status='succeeded' and v_donation.utr is distinct from v_utr then raise exception 'Donation is already verified with a different reference'; end if;
    update public.donation_intents set status='succeeded', verified_at=coalesce(verified_at,now()), utr=v_utr, admin_removed=false, updated_at=now()
      where id=v_donation.id;
    update public.donation_manual_review_claims set status='confirmed', claimed_utr=v_utr, admin_review_note=left(nullif(btrim(p_note),''),1000), reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=v_claim.id;
    insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
      values(v_donation.id,v_claim.id,auth.uid(),'manual_donation_confirmed',jsonb_build_object('utr',v_utr,'note',p_note));
    return jsonb_build_object('status','confirmed','message','Donation marked verified after manual bank-reference review.');
  else
    update public.donation_manual_review_claims set status='rejected', admin_review_note=left(nullif(btrim(p_note),''),1000), reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=v_claim.id;
    insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
      values(v_donation.id,v_claim.id,auth.uid(),'manual_donation_claim_rejected',jsonb_build_object('note',p_note));
    return jsonb_build_object('status','rejected','message','Manual claim rejected. The underlying payment record was not falsely marked paid.');
  end if;
end $$;
revoke all on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) from public,anon;
grant execute on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) to authenticated;

create or replace function public.janwatch_admin_set_donation_removed(p_donation_id uuid,p_removed boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_role text; v_status text;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  update public.donation_intents set admin_removed=p_removed,updated_at=now() where id=p_donation_id returning status into v_status;
  if not found then raise exception 'Donation not found'; end if;
  insert into public.donation_admin_review_audit(donation_intent_id,actor_id,action,details)
    values(p_donation_id,auth.uid(),case when p_removed then 'donation_removed_from_public_totals' else 'donation_restored_to_public_totals' end,jsonb_build_object('status',v_status));
  return jsonb_build_object('status','saved','removed',p_removed);
end $$;
revoke all on function public.janwatch_admin_set_donation_removed(uuid,boolean) from public,anon;
grant execute on function public.janwatch_admin_set_donation_removed(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
