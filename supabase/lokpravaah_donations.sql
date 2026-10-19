-- LokPravaah Donation + UPI integration data layer.
-- Apply AFTER schema.sql, v4_platform_migration.sql and lokpravaah_final_worker_blog_patch.sql.
-- Safe to re-run. Browser clients cannot mark donations as paid; only the signed server webhook may do so.

create table if not exists public.donation_intents (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique check (char_length(order_id) between 8 and 80),
  donor_user_id uuid references auth.users(id) on delete set null,
  amount_paise bigint not null check (amount_paise between 100 and 10000000),
  currency text not null default 'INR' check (currency = 'INR'),
  donor_name text check (donor_name is null or char_length(btrim(donor_name)) <= 80),
  donor_email text check (donor_email is null or char_length(btrim(donor_email)) <= 254),
  is_anonymous boolean not null default false,
  show_on_leaderboard boolean not null default false,
  show_message_publicly boolean not null default false,
  admin_hidden boolean not null default false,
  message text check (message is null or char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','suspicious','expired','cancelled')),
  gateway_payment_id text,
  utr text unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donation_anonymous_pii_check check (not is_anonymous or (donor_name is null and donor_email is null)),
  constraint donation_verification_consistency_check check (
    (status <> 'succeeded' and verified_at is null) or (status = 'succeeded' and verified_at is not null)
  )
);

alter table public.donation_intents add column if not exists show_on_leaderboard boolean not null default false;
alter table public.donation_intents alter column show_on_leaderboard set default false;
alter table public.donation_intents add column if not exists show_message_publicly boolean not null default false;
alter table public.donation_intents alter column show_message_publicly set default false;
alter table public.donation_intents add column if not exists admin_hidden boolean not null default false;
create index if not exists donation_intents_created_idx on public.donation_intents(created_at desc);
create index if not exists donation_intents_status_idx on public.donation_intents(status, created_at desc);
create index if not exists donation_intents_user_idx on public.donation_intents(donor_user_id, created_at desc) where donor_user_id is not null;
create index if not exists donation_intents_public_paid_idx on public.donation_intents(verified_at desc) where status = 'succeeded' and admin_hidden = false;

-- Older releases did not present explicit leaderboard consent. Hide those old entries once;
-- new donations carry an explicit show_on_leaderboard value from the new form.
create table if not exists public.donation_migration_flags (
  flag_key text primary key,
  applied_at timestamptz not null default now()
);
alter table public.donation_migration_flags enable row level security;
revoke all on public.donation_migration_flags from public, anon, authenticated;
grant all on public.donation_migration_flags to service_role;
do $$
begin
  if not exists (select 1 from public.donation_migration_flags where flag_key = 'leaderboard_explicit_consent_v1') then
    update public.donation_intents set show_on_leaderboard = false;
    insert into public.donation_migration_flags(flag_key) values ('leaderboard_explicit_consent_v1') on conflict do nothing;
  end if;
end;
$$;

alter table public.donation_intents enable row level security;
drop policy if exists "donation create pending intent" on public.donation_intents;
create policy "donation create pending intent" on public.donation_intents
  for insert to anon, authenticated
  with check (
    status = 'pending' and gateway_payment_id is null and utr is null and verified_at is null and admin_hidden = false
    and currency = 'INR' and amount_paise between 100 and 10000000
    and (donor_user_id is null or donor_user_id = auth.uid())
    and (donor_name is null or char_length(btrim(donor_name)) <= 80)
    and (donor_email is null or char_length(btrim(donor_email)) <= 254)
    and (message is null or char_length(message) <= 300)
    and (not is_anonymous or (donor_name is null and donor_email is null))
    and (not show_message_publicly or (not is_anonymous and show_on_leaderboard))
  );
drop policy if exists "donation admins can review intents" on public.donation_intents;
create policy "donation admins can review intents" on public.donation_intents
  for select to authenticated using (public.is_janwatch_admin());
revoke all on public.donation_intents from anon, authenticated;
grant insert on public.donation_intents to anon, authenticated;
grant select on public.donation_intents to authenticated;
grant all on public.donation_intents to service_role;

-- Only safe public presentation controls are stored here. Gateway secrets must stay in server environment variables.
create table if not exists public.donation_settings (
  id boolean primary key default true check (id = true),
  donations_enabled boolean not null default true,
  payment_gateway_enabled boolean not null default true,
  gateway_portal_url text check (gateway_portal_url is null or gateway_portal_url ~* '^https://'),
  gateway_api_url text check (gateway_api_url is null or gateway_api_url ~* '^https://'),
  gateway_merchant_key text check (gateway_merchant_key is null or char_length(gateway_merchant_key) <= 200),
  leaderboard_enabled boolean not null default true,
  show_public_total boolean not null default true,
  show_goal_progress boolean not null default true,
  show_recent_donations boolean not null default true,
  show_donor_messages boolean not null default true,
  campaign_title text not null default 'Build a stronger civic community',
  campaign_description text not null default 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise bigint not null default 5000000 check (campaign_goal_paise between 10000 and 100000000000),
  min_amount_paise bigint not null default 100 check (min_amount_paise between 100 and 10000000),
  max_amount_paise bigint not null default 10000000 check (max_amount_paise between 100 and 10000000),
  suggested_amounts jsonb not null default '[51,101,251,501,1001,2100]'::jsonb check (jsonb_typeof(suggested_amounts) = 'array'),
  thank_you_title text not null default 'Thank you for backing civic action',
  thank_you_message text not null default 'Your support helps us keep improving LokPravaah for the community.',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint donation_settings_amount_order check (min_amount_paise <= max_amount_paise)
);
insert into public.donation_settings(id) values (true) on conflict (id) do nothing;
alter table public.donation_settings add column if not exists gateway_portal_url text;
alter table public.donation_settings add column if not exists gateway_api_url text;
alter table public.donation_settings add column if not exists gateway_merchant_key text;
alter table public.donation_settings enable row level security;
revoke all on public.donation_settings from anon, authenticated;
grant all on public.donation_settings to service_role;

create table if not exists public.donation_settings_change_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  changes jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists donation_settings_requests_idx on public.donation_settings_change_requests(status, created_at desc);
alter table public.donation_settings_change_requests enable row level security;
revoke all on public.donation_settings_change_requests from anon, authenticated;
grant all on public.donation_settings_change_requests to service_role;

-- Safe public API: aggregate totals and opt-in public identities only. Never returns e-mail, UTR or order IDs.
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
    return jsonb_build_object('settings', jsonb_build_object('donations_enabled', true, 'payment_gateway_enabled', true, 'gateway_portal_url', null, 'gateway_api_url', null, 'gateway_merchant_key', null, 'leaderboard_enabled', true, 'show_public_total', true, 'show_goal_progress', true, 'show_recent_donations', true, 'show_donor_messages', true, 'campaign_title', 'Build a stronger civic community', 'campaign_description', 'Your contribution helps keep LokPravaah available, accessible and improving.', 'campaign_goal_paise', 5000000, 'min_amount_paise', 100, 'max_amount_paise', 10000000, 'suggested_amounts', '[51,101,251,501,1001,2100]'::jsonb, 'thank_you_title', 'Thank you for backing civic action', 'thank_you_message', 'Your support helps us keep improving LokPravaah for the community.'), 'total_raised_paise', 0, 'successful_donations', 0, 'top_donors', '[]'::jsonb, 'recent_donations', '[]'::jsonb);
  end if;

  select coalesce(sum(amount_paise), 0), count(*) into v_total, v_count
  from public.donation_intents where status = 'succeeded';

  if v_settings.leaderboard_enabled then
    with grouped as (
      select
        coalesce('user:' || donor_user_id::text, 'guest:' || lower(coalesce(nullif(btrim(donor_email), ''), nullif(btrim(donor_name), ''), order_id))) as donor_key,
        max(coalesce(nullif(btrim(donor_name), ''), 'Community supporter')) as donor_name,
        sum(amount_paise)::bigint as total_paise,
        count(*)::bigint as donations_count
      from public.donation_intents
      where status = 'succeeded' and is_anonymous = false and show_on_leaderboard = true and admin_hidden = false
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
    from (select * from public.donation_intents where status = 'succeeded' and not admin_hidden order by verified_at desc limit 8) recent;
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
revoke all on function public.janwatch_get_public_donation_data() from public;
grant execute on function public.janwatch_get_public_donation_data() to anon, authenticated;

-- Private admin RPC. PII and payment references are available only to verified administrators.
create or replace function public.janwatch_admin_get_donation_data()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_role text; v_settings jsonb; v_donations jsonb; v_requests jsonb;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  select to_jsonb(s) - 'id' into v_settings from public.donation_settings s where id = true;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'order_id', d.order_id, 'amount_paise', d.amount_paise, 'currency', d.currency,
    'donor_user_id', d.donor_user_id, 'donor_name', d.donor_name, 'donor_email', d.donor_email,
    'is_anonymous', d.is_anonymous, 'show_on_leaderboard', d.show_on_leaderboard, 'show_message_publicly', d.show_message_publicly, 'admin_hidden', d.admin_hidden,
    'message', d.message, 'status', d.status, 'utr', d.utr, 'gateway_payment_id', d.gateway_payment_id,
    'created_at', d.created_at, 'verified_at', d.verified_at
  ) order by d.created_at desc), '[]'::jsonb) into v_donations from (select * from public.donation_intents order by created_at desc limit 150) d;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'requested_by', r.requested_by, 'changes', r.changes, 'status', r.status, 'review_note', r.review_note, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into v_requests from (select * from public.donation_settings_change_requests order by created_at desc limit 100) r;
  return jsonb_build_object('role', v_role, 'settings', coalesce(v_settings, '{}'::jsonb), 'donations', v_donations, 'change_requests', v_requests);
end;
$$;
revoke all on function public.janwatch_admin_get_donation_data() from public, anon;
grant execute on function public.janwatch_admin_get_donation_data() to authenticated;

-- Admin may update ordinary presentation settings immediately. Major payment/target changes queue for super-admin approval.
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
      min_amount_paise = v_min, max_amount_paise = v_max, campaign_goal_paise = v_goal, suggested_amounts = v_suggested,
      updated_by = auth.uid(), updated_at = now() where id = true;
    return jsonb_build_object('status','saved','message','Donation settings saved.');
  elsif v_major <> '{}'::jsonb then
    insert into public.donation_settings_change_requests(requested_by, changes) values (auth.uid(), v_major) returning id into v_request_id;
    return jsonb_build_object('status','pending_approval','request_id',v_request_id,'message','Presentation settings saved. Major changes are waiting for super-admin approval.');
  end if;
  return jsonb_build_object('status','saved','message','Donation presentation settings saved.');
end;
$$;
revoke all on function public.janwatch_admin_update_donation_settings(jsonb) from public, anon;
grant execute on function public.janwatch_admin_update_donation_settings(jsonb) to authenticated;

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
      updated_by = auth.uid(), updated_at = now()
    where id = true;
    update public.donation_settings_change_requests set status = 'approved', review_note = left(nullif(btrim(p_note),''),500), reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
    return jsonb_build_object('status','approved','message','Major donation settings change approved and applied.');
  end if;
  update public.donation_settings_change_requests set status = 'rejected', review_note = left(nullif(btrim(p_note),''),500), reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  return jsonb_build_object('status','rejected','message','Major donation settings change rejected.');
end;
$$;
revoke all on function public.janwatch_super_admin_review_donation_settings(uuid, boolean, text) from public, anon;
grant execute on function public.janwatch_super_admin_review_donation_settings(uuid, boolean, text) to authenticated;

create or replace function public.janwatch_admin_set_donation_visibility(p_donation_id uuid, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_role text; v_status text;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  update public.donation_intents set admin_hidden = p_hidden, updated_at = now()
    where id = p_donation_id and status = 'succeeded' returning status into v_status;
  if not found then raise exception 'Only verified donations can be hidden or restored'; end if;
  return jsonb_build_object('status','saved','hidden',p_hidden);
end;
$$;
revoke all on function public.janwatch_admin_set_donation_visibility(uuid, boolean) from public, anon;
grant execute on function public.janwatch_admin_set_donation_visibility(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
