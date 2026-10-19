-- LokPravaah complete UPI concurrency + timer + manual verification + ticket support migration.
-- Run AFTER supabase/lokpravaah_donations.sql AND supabase/lokpravaah_cloudflare_gateway.sql.
-- Take a database backup before applying. Safe to rerun after a failed partial run.
-- This migration does not expose any standalone /admin page and stores no private API keys.

-- LokPravaah: concurrent UPI sessions + user/admin ticket support
-- Run in Supabase SQL Editor after taking a database backup.

-- Payment sessions must be independent. A donor must not occupy a global merchant slot.
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

-- Ticket categories/subcategories are data-driven and editable by admins.
create table if not exists public.support_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  subcategory text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(category, subcategory)
);
insert into public.support_ticket_categories(category,subcategory,sort_order) values
 ('Donations & UPI','Paid but website not confirmed',1),
 ('Donations & UPI','Payment pending / processing',2),
 ('Donations & UPI','Payment failed but money debited',3),
 ('Donations & UPI','Refund / duplicate payment',4),
 ('Donations & UPI','QR / checkout not working',5),
 ('Account & Login','Login / OTP issue',10),
 ('Account & Login','Google sign-in issue',11),
 ('Reports & Complaints','Submit or update a report',20),
 ('Rewards & Withdrawals','Reward or withdrawal issue',30),
 ('Website & Technical','Bug / broken page',40),
 ('Website & Technical','Other technical issue',41),
 ('Other','General question',50)
on conflict(category,subcategory) do nothing;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  subcategory text not null,
  subject text not null check (char_length(subject) between 4 and 160),
  description text not null check (char_length(description) between 10 and 8000),
  status text not null default 'open' check (status in ('open','in_progress','waiting_for_user','pending_review','resolved','closed','rejected')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  payment_order_id text,
  payment_reference text,
  claimed_amount_paise bigint check (claimed_amount_paise is null or claimed_amount_paise >= 0),
  payment_timestamp timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id,created_at desc);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status,priority,created_at);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 8000),
  is_internal_note boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id,created_at);

create table if not exists public.support_ticket_audit (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.support_touch_updated_at()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists support_tickets_touch_updated_at on public.support_tickets;
create trigger support_tickets_touch_updated_at before update on public.support_tickets for each row execute function public.support_touch_updated_at();

alter table public.support_ticket_categories enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_audit enable row level security;

drop policy if exists support_categories_read_active on public.support_ticket_categories;
create policy support_categories_read_active on public.support_ticket_categories for select to authenticated using (active or public.is_janwatch_admin());
drop policy if exists support_categories_admin_manage on public.support_ticket_categories;
create policy support_categories_admin_manage on public.support_ticket_categories for all to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_tickets_read_own_or_admin on public.support_tickets;
create policy support_tickets_read_own_or_admin on public.support_tickets for select to authenticated using (user_id=auth.uid() or public.is_janwatch_admin());
drop policy if exists support_tickets_create_own on public.support_tickets;
create policy support_tickets_create_own on public.support_tickets for insert to authenticated with check (user_id=auth.uid());
drop policy if exists support_tickets_update_admin_or_owner on public.support_tickets;
create policy support_tickets_update_admin_or_owner on public.support_tickets for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_messages_read_ticket on public.support_ticket_messages;
create policy support_messages_read_ticket on public.support_ticket_messages for select to authenticated using (
  exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_messages_insert_ticket on public.support_ticket_messages;
create policy support_messages_insert_ticket on public.support_ticket_messages for insert to authenticated with check (
  sender_id=auth.uid() and exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_audit_read_admin on public.support_ticket_audit;
create policy support_audit_read_admin on public.support_ticket_audit for select to authenticated using (public.is_janwatch_admin());
drop policy if exists support_audit_insert_admin_or_actor on public.support_ticket_audit;
create policy support_audit_insert_admin_or_actor on public.support_ticket_audit for insert to authenticated with check (actor_id=auth.uid() and (public.is_janwatch_admin() or exists(select 1 from public.support_tickets t where t.id=ticket_id and t.user_id=auth.uid())));

-- Private evidence bucket: attachments are never public. Storage access is mediated by authenticated ticket ownership/admin policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('support-ticket-evidence','support-ticket-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists support_evidence_upload_authenticated on storage.objects;
create policy support_evidence_upload_authenticated on storage.objects for insert to authenticated with check (
 bucket_id='support-ticket-evidence' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists support_evidence_read_owner_admin on storage.objects;
create policy support_evidence_read_owner_admin on storage.objects for select to authenticated using (
 bucket_id='support-ticket-evidence' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_janwatch_admin())
);


-- 1. Database-backed checkout timer and receiving-account settings controlled in the protected Admin Console.
alter table public.donation_settings add column if not exists upi_vpa text;
alter table public.donation_settings add column if not exists upi_payee_name text;
alter table public.donation_settings add column if not exists payment_session_minutes integer not null default 15;
alter table public.donation_settings drop constraint if exists donation_settings_payment_session_minutes_check;
alter table public.donation_settings add constraint donation_settings_payment_session_minutes_check check (payment_session_minutes between 5 and 30);
alter table public.donation_settings drop constraint if exists donation_settings_upi_vpa_check;
alter table public.donation_settings add constraint donation_settings_upi_vpa_check check (upi_vpa is null or upi_vpa ~ '^[^[:space:]@]+@[^[:space:]@]+$');
alter table public.donation_settings drop constraint if exists donation_settings_upi_payee_name_check;
alter table public.donation_settings add constraint donation_settings_upi_payee_name_check check (upi_payee_name is null or char_length(btrim(upi_payee_name)) between 1 and 80);

-- 2. Remove the conflicting unique index that caused later donors' checkout creation to fail.
-- Short database transactions still lock matching observations; payment sessions do not lock each other.
drop index if exists public.upi_gateway_single_active_slot_uq;
alter table public.upi_gateway_payments add column if not exists receiver_vpa text;
alter table public.upi_gateway_payments add column if not exists receiver_name text;

create or replace function public.upi_gateway_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_expired integer := 0;
begin
  update public.upi_gateway_payments
    set status='EXPIRED', queue_position=0, updated_at=now()
    where status='ACTIVE' and expires_at is not null and expires_at <= now();
  get diagnostics v_expired = row_count;
  -- Legacy queued rows are activated separately; new creates never join a queue.
  update public.upi_gateway_payments p
    set status='ACTIVE', queue_position=0,
        expires_at=now()+make_interval(mins=>greatest(5,least(30,p.session_minutes))),
        updated_at=now()
    where p.status='QUEUED';
  return jsonb_build_object('ok',true,'expiredCount',v_expired);
end;
$$;
revoke all on function public.upi_gateway_tick() from public, anon, authenticated;
grant execute on function public.upi_gateway_tick() to service_role;

-- Remove the previous six-parameter RPC so PostgREST cannot select stale queue logic.
drop function if exists public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer);
create function public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text default null,
  p_session_minutes integer default 15,
  p_receiver_vpa text default null,
  p_receiver_name text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer;
  v_db_minutes integer;
  v_vpa text := nullif(btrim(p_receiver_vpa),'');
  v_name text := nullif(btrim(p_receiver_name),'');
  v_configured_merchant text;
begin
  -- Share the short-lived observer lock to avoid a new same-amount session appearing between
  -- candidate-count and observation-match statements. This lock ends with this DB transaction;
  -- it never waits for a donor to complete payment and is not a per-merchant checkout queue.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-observation-v2'));
  select * into v_donation from public.donation_intents where order_id=p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then raise exception 'DONATION_AMOUNT_MISMATCH'; end if;

  select * into v_existing from public.upi_gateway_payments where order_id=p_order_id limit 1;
  if found then
    return jsonb_build_object('paymentId',v_existing.id,'orderId',v_existing.order_id,
      'amount',to_char(v_existing.amount_paise/100.0,'FM999999990.00'),
      'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
      'status',v_existing.status,'queuePosition',v_existing.queue_position,
      'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at);
  end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  select nullif(btrim(gateway_merchant_key),'') into v_configured_merchant from public.donation_settings where id=true;
  v_configured_merchant := coalesce(v_configured_merchant, '00000000-0000-0000-0000-000000000001');
  if p_merchant_id is distinct from v_configured_merchant then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;
  if v_vpa is null or v_vpa !~ '^[^[:space:]@]+@[^[:space:]@]+$' or v_name is null or char_length(v_name)>80 then raise exception 'UPI_RECEIVER_NOT_CONFIGURED'; end if;

  select payment_session_minutes into v_db_minutes from public.donation_settings where id=true;
  v_minutes := greatest(5,least(30,coalesce(v_db_minutes,p_session_minutes,15)));
  insert into public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,receiver_vpa,receiver_name,created_at,updated_at
  ) values(
    p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),v_vpa,v_name,now(),now()
  ) returning * into v_created;
  return jsonb_build_object('paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise/100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,'completedAt',v_created.completed_at);
end;
$$;
revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) to service_role;

-- Match a bank-credit notification only if exactly ONE open session has the same amount/time.
-- Same-amount overlapping payments are intentionally left UNMATCHED for safe manual review.
create or replace function public.upi_gateway_prepare_observation(
  p_observation_id uuid,
  p_device_id text,
  p_amount_paise bigint,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_device public.upi_gateway_devices%rowtype;
  v_existing public.upi_gateway_observations%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_observed timestamptz := coalesce(p_observed_at,now());
  v_candidates integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-observation-v2'));
  select * into v_device from public.upi_gateway_devices where id=p_device_id and is_active=true;
  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 or p_bank_reference_number is null or char_length(p_bank_reference_number) not between 6 and 80 then raise exception 'INVALID_OBSERVATION'; end if;
  if abs(extract(epoch from(now()-v_observed))) > 600 then raise exception 'OBSERVATION_TIME_OUT_OF_RANGE'; end if;

  select * into v_existing from public.upi_gateway_observations where bank_reference_number=p_bank_reference_number;
  if found then
    if v_existing.matched_payment_id is null then return jsonb_build_object('matched',false,'duplicate',true,'status',v_existing.status,'ambiguous',true); end if;
    select * into v_payment from public.upi_gateway_payments where id=v_existing.matched_payment_id;
    return jsonb_build_object('matched',true,'duplicate',true,'status',v_payment.status,'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
  end if;

  insert into public.upi_gateway_observations(id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at)
    values(coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());

  select count(*) into v_candidates from public.upi_gateway_payments p
    where p.merchant_id=v_device.merchant_id and p.status='ACTIVE' and p.amount_paise=p_amount_paise
      and p.created_at<=v_observed and p.expires_at is not null and p.expires_at>=v_observed;
  if v_candidates <> 1 then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','ambiguous',v_candidates>1,'candidateCount',v_candidates,
      'message',case when v_candidates>1 then 'Multiple open donations have the same amount; manual review required.' else 'No unique open donation matched this bank notification.' end);
  end if;

  select * into v_payment from public.upi_gateway_payments p
    where p.merchant_id=v_device.merchant_id and p.status='ACTIVE' and p.amount_paise=p_amount_paise
      and p.created_at<=v_observed and p.expires_at is not null and p.expires_at>=v_observed
    for update;
  if not found then return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','candidateCount',0); end if;
  update public.upi_gateway_payments set status='PROCESSING',bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''),observed_at=v_observed,processing_started_at=now(),updated_at=now()
    where id=v_payment.id;
  update public.upi_gateway_observations set status='PROCESSING',matched_payment_id=v_payment.id where bank_reference_number=p_bank_reference_number;
  return jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING','paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
end;
$$;
revoke all on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) to service_role;


-- Public donation response: include effective timer, but keep receiving-account fields out of this public response.
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
    return jsonb_build_object('settings', jsonb_build_object('donations_enabled', true, 'payment_gateway_enabled', true, 'gateway_portal_url', null, 'gateway_api_url', null, 'gateway_merchant_key', null, 'leaderboard_enabled', true, 'show_public_total', true, 'show_goal_progress', true, 'show_recent_donations', true, 'show_donor_messages', true, 'campaign_title', 'Build a stronger civic community', 'campaign_description', 'Your contribution helps keep LokPravaah available, accessible and improving.', 'campaign_goal_paise', 5000000, 'min_amount_paise', 100, 'max_amount_paise', 10000000, 'payment_session_minutes', 15, 'suggested_amounts', '[51,101,251,501,1001,2100]'::jsonb, 'thank_you_title', 'Thank you for backing civic action', 'thank_you_message', 'Your support helps us keep improving LokPravaah for the community.'), 'total_raised_paise', 0, 'successful_donations', 0, 'top_donors', '[]'::jsonb, 'recent_donations', '[]'::jsonb);
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
      'payment_session_minutes', v_settings.payment_session_minutes,
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

-- Admin donation data: return up to 500 records, prioritizing all unverified states before successful history.
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
  ) order by (d.status = 'succeeded') asc, d.created_at desc), '[]'::jsonb) into v_donations from (select * from public.donation_intents order by (status = 'succeeded') asc, created_at desc limit 500) d;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'requested_by', r.requested_by, 'changes', r.changes, 'status', r.status, 'review_note', r.review_note, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into v_requests from (select * from public.donation_settings_change_requests order by created_at desc limit 100) r;
  return jsonb_build_object('role', v_role, 'settings', coalesce(v_settings, '{}'::jsonb), 'donations', v_donations, 'change_requests', v_requests);
end;
$$;
revoke all on function public.janwatch_admin_get_donation_data() from public, anon;
grant execute on function public.janwatch_admin_get_donation_data() to authenticated;

-- Timer and receiving-account values are major changes; normal admins queue for super-admin approval.
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
  v_upi_vpa text;
  v_upi_payee_name text;
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
  v_session_minutes := coalesce(nullif(p_settings->>'payment_session_minutes','')::integer, v_current.payment_session_minutes, 15);
  v_upi_vpa := case when p_settings ? 'upi_vpa' then nullif(btrim(p_settings->>'upi_vpa'), '') else v_current.upi_vpa end;
  v_upi_payee_name := case when p_settings ? 'upi_payee_name' then nullif(btrim(p_settings->>'upi_payee_name'), '') else v_current.upi_payee_name end;
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
  if v_session_minutes < 5 or v_session_minutes > 30 then raise exception 'UPI checkout timer must be between 5 and 30 minutes'; end if;
  if v_upi_vpa is not null and v_upi_vpa !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'Receiving UPI ID is invalid'; end if;
  if v_upi_payee_name is not null and length(v_upi_payee_name) > 80 then raise exception 'UPI payee name is too long'; end if;
  if (v_upi_vpa is null) <> (v_upi_payee_name is null) then raise exception 'Set both receiving UPI ID and payee name, or leave both blank to use server environment settings'; end if;
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
  if v_upi_vpa is distinct from v_current.upi_vpa then v_major := v_major || jsonb_build_object('upi_vpa', v_upi_vpa); end if;
  if v_upi_payee_name is distinct from v_current.upi_payee_name then v_major := v_major || jsonb_build_object('upi_payee_name', v_upi_payee_name); end if;
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
      payment_session_minutes = v_session_minutes, upi_vpa = v_upi_vpa, upi_payee_name = v_upi_payee_name,
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
      payment_session_minutes = coalesce((v_request.changes->>'payment_session_minutes')::integer, payment_session_minutes),
      upi_vpa = case when v_request.changes ? 'upi_vpa' then nullif(v_request.changes->>'upi_vpa','') else upi_vpa end,
      upi_payee_name = case when v_request.changes ? 'upi_payee_name' then nullif(v_request.changes->>'upi_payee_name','') else upi_payee_name end,
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


-- Manual verification log; private to security-definer RPC/server processes.
create table if not exists public.donation_manual_reviews (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donation_intents(id) on delete cascade,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  order_id text not null,
  amount_paise bigint not null,
  utr text not null check (utr ~ '^[A-Za-z0-9_-]{6,80}$'),
  review_note text not null check (char_length(btrim(review_note)) between 5 and 500),
  prior_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists donation_manual_reviews_donation_idx on public.donation_manual_reviews(donation_id,created_at desc);
alter table public.donation_manual_reviews enable row level security;
revoke all on public.donation_manual_reviews from public, anon, authenticated;
grant all on public.donation_manual_reviews to service_role;

create or replace function public.janwatch_admin_manual_verify_donation(
  p_donation_id uuid,
  p_utr text,
  p_note text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare
  v_role text;
  v_donation public.donation_intents%rowtype;
  v_gateway public.upi_gateway_payments%rowtype;
  v_utr text := nullif(btrim(p_utr),'');
  v_note text := nullif(btrim(p_note),'');
  v_previous_status text;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then raise exception 'A real UTR/bank reference (6-80 characters) is required'; end if;
  if v_note is null or char_length(v_note) not between 5 and 500 then raise exception 'Add a review note (5-500 characters)'; end if;

  select * into v_donation from public.donation_intents where id=p_donation_id for update;
  if not found then raise exception 'Donation record not found'; end if;
  if v_donation.status='succeeded' then
    if v_donation.utr=v_utr then return jsonb_build_object('status','succeeded','alreadyVerified',true,'message','This donation was already verified with the same UTR.'); end if;
    raise exception 'Donation is already verified with a different UTR';
  end if;
  if v_donation.status not in ('pending','failed','suspicious','expired','cancelled') then raise exception 'Donation state is not eligible for manual verification'; end if;
  if exists(select 1 from public.donation_intents d where d.utr=v_utr and d.id<>p_donation_id) then raise exception 'This UTR is already linked to another donation'; end if;
  if exists(select 1 from public.upi_gateway_payments p where p.bank_reference_number=v_utr and p.order_id<>v_donation.order_id) then raise exception 'This bank reference is linked to another payment order'; end if;

  select * into v_gateway from public.upi_gateway_payments where order_id=v_donation.order_id for update;
  if found and v_gateway.status='SUCCESS' and v_gateway.bank_reference_number is distinct from v_utr then raise exception 'Gateway already records a different successful bank reference for this order'; end if;
  v_previous_status := v_donation.status;
  update public.donation_intents set status='succeeded',utr=v_utr,verified_at=now(),updated_at=now(),
    gateway_payment_id=coalesce(gateway_payment_id,v_gateway.id::text)
    where id=p_donation_id;
  insert into public.donation_manual_reviews(donation_id,reviewed_by,order_id,amount_paise,utr,review_note,prior_status)
    values(p_donation_id,auth.uid(),v_donation.order_id,v_donation.amount_paise,v_utr,v_note,v_previous_status);

  update public.upi_gateway_payments set status='SUCCESS',queue_position=0,bank_reference_number=v_utr,
    completed_at=coalesce(completed_at,now()),observed_at=coalesce(observed_at,now()),updated_at=now()
    where order_id=v_donation.order_id and status in ('ACTIVE','PROCESSING','FAILED','EXPIRED','CANCELLED','SUSPICIOUS');
  update public.upi_gateway_observations set status='SUCCESS',matched_payment_id=v_gateway.id
    where bank_reference_number=v_utr and v_gateway.id is not null and status in ('UNMATCHED','PROCESSING');
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'donation_manually_verified','donation',p_donation_id::text,
      jsonb_build_object('order_id',v_donation.order_id,'amount_paise',v_donation.amount_paise,'utr',v_utr,'prior_status',v_previous_status,'review_note',v_note));
  return jsonb_build_object('status','succeeded','alreadyVerified',false,'message','Donation manually verified. UTR and review note were saved to the private audit trail.');
end;
$$;
revoke all on function public.janwatch_admin_manual_verify_donation(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_manual_verify_donation(uuid,text,text) to authenticated;

-- Support RLS policies stay authoritative; grants only expose operations permitted by each policy.
grant select,insert,update,delete on public.support_ticket_categories to authenticated;
grant select,insert,update on public.support_tickets to authenticated;
grant select,insert on public.support_ticket_messages to authenticated;
grant select,insert on public.support_ticket_audit to authenticated;

notify pgrst, 'reload schema';
