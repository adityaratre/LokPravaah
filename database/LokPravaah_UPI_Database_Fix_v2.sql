-- LokPravaah UPI reliability + parallel checkout + manual payment review migration
-- For an EXISTING LokPravaah Supabase project where donation_intents,
-- donation_settings, upi_gateway_payments, upi_gateway_devices and
-- upi_gateway_observations already exist.
-- Take a database backup before running. This migration is designed to be re-runnable.
-- It does not contain API keys or webhook secrets.

begin;

-- Fail early with a useful error if the prerequisite migrations are missing.
do $$
begin
  if to_regclass('public.donation_intents') is null
     or to_regclass('public.donation_settings') is null
     or to_regclass('public.upi_gateway_payments') is null
     or to_regclass('public.upi_gateway_devices') is null
     or to_regclass('public.upi_gateway_observations') is null then
    raise exception 'Prerequisite tables missing. Apply the LokPravaah donations and Cloudflare gateway migrations first.';
  end if;
end $$;

-- 1) Admin-configurable checkout timer/recovery settings.
alter table public.donation_settings
  add column if not exists payment_session_minutes integer not null default 15,
  add column if not exists payment_processing_grace_minutes integer not null default 30,
  add column if not exists manual_payment_review_enabled boolean not null default true,
  add column if not exists payment_proof_upload_enabled boolean not null default true,
  add column if not exists allow_parallel_payment_sessions boolean not null default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.donation_settings'::regclass and conname='donation_settings_payment_session_minutes_chk') then
    alter table public.donation_settings add constraint donation_settings_payment_session_minutes_chk check (payment_session_minutes between 5 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.donation_settings'::regclass and conname='donation_settings_payment_grace_minutes_chk') then
    alter table public.donation_settings add constraint donation_settings_payment_grace_minutes_chk check (payment_processing_grace_minutes between 5 and 120);
  end if;
end $$;

-- 2) Store a UPI reference <=35 characters and retain failed/expired attempts for audit.
alter table public.upi_gateway_payments
  add column if not exists upi_transaction_ref text,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists failure_code text,
  add column if not exists failure_message text;

update public.upi_gateway_payments
set upi_transaction_ref = replace(id::text, '-', '')
where upi_transaction_ref is null or char_length(upi_transaction_ref) > 35;

create unique index if not exists upi_gateway_transaction_ref_uq
  on public.upi_gateway_payments(upi_transaction_ref)
  where upi_transaction_ref is not null;
create index if not exists upi_gateway_order_attempts_idx
  on public.upi_gateway_payments(order_id, created_at desc);

-- Remove the old global one-active-payment-per-merchant index. It caused concurrent
-- checkout creation to fail or queue behind another donor even when the donors were unrelated.
drop index if exists public.upi_gateway_single_active_slot_uq;

-- Allow multiple payment attempts to reference the same donation intent. The donation_intents
-- order_id remains unique; only the gateway attempts become one-to-many.
do $$
declare c record; order_att smallint;
begin
  select attnum into order_att from pg_attribute
    where attrelid='public.upi_gateway_payments'::regclass and attname='order_id' and not attisdropped;
  for c in
    select conname from pg_constraint
    where conrelid='public.upi_gateway_payments'::regclass
      and contype='u' and array_length(conkey,1)=1 and conkey[1]=order_att
  loop
    execute format('alter table public.upi_gateway_payments drop constraint %I', c.conname);
  end loop;
end $$;

-- 3) Independent sessions: no global merchant lock and no wait for another donor to finish.
-- Old queued sessions are promoted together; their payment windows remain independent.
create or replace function public.upi_gateway_tick()
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_expired integer := 0; v_promoted integer := 0; v_parallel boolean := true; v_next public.upi_gateway_payments%rowtype;
begin
  select coalesce(allow_parallel_payment_sessions,true) into v_parallel from public.donation_settings where id=true;
  update public.upi_gateway_payments
    set status='EXPIRED', queue_position=0, updated_at=now()
    where status='ACTIVE' and expires_at is not null and expires_at <= now();
  get diagnostics v_expired = row_count;

  if v_parallel then
    update public.upi_gateway_payments
      set status='ACTIVE', queue_position=0,
          expires_at=coalesce(expires_at, now() + make_interval(mins => greatest(5, least(30, session_minutes)))),
          updated_at=now()
      where status='QUEUED';
    get diagnostics v_promoted = row_count;
  elsif not exists (select 1 from public.upi_gateway_payments where status in ('ACTIVE','PROCESSING')) then
    select * into v_next from public.upi_gateway_payments where status='QUEUED'
      order by created_at asc limit 1 for update skip locked;
    if found then
      update public.upi_gateway_payments set status='ACTIVE',queue_position=0,
        expires_at=now()+make_interval(mins=>greatest(5,least(30,session_minutes))),updated_at=now()
        where id=v_next.id;
      v_promoted := 1;
    end if;
  end if;

  with ranked as (
    select id,row_number() over(order by created_at asc) as rn from public.upi_gateway_payments where status='QUEUED'
  ) update public.upi_gateway_payments p set queue_position=ranked.rn::integer,updated_at=now()
      from ranked where p.id=ranked.id;
  update public.upi_gateway_payments set queue_position=0
    where status <> 'QUEUED' and queue_position <> 0;

  return jsonb_build_object('ok',true,'expired',v_expired,'legacyQueuedActivated',v_promoted,'parallelSessions',v_parallel);
end;
$$;

-- A single donation order reuses an active/processing session for idempotency, but a new attempt
-- can be created after an earlier attempt is expired/cancelled/failed. Only same-order requests
-- serialize on the donation row; different donors can create sessions concurrently.
create or replace function public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text default null,
  p_session_minutes integer default 15
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer := greatest(5,least(30,coalesce(p_session_minutes,15)));
  v_attempt integer;
  v_parallel boolean := true;
  v_new_status text := 'ACTIVE';
  v_queue integer := 0;
  v_expires timestamptz;
begin
  select * into v_donation from public.donation_intents where order_id=p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then raise exception 'DONATION_AMOUNT_MISMATCH'; end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_merchant_id <> '00000000-0000-0000-0000-000000000001' then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;
  select coalesce(allow_parallel_payment_sessions,true) into v_parallel from public.donation_settings where id=true;
  -- Same-amount lock only protects observer matching from racing with checkout creation;
  -- it is held for milliseconds and never waits for another donor's payment to finish.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-upi-amount:'||p_amount_paise::text));
  if not v_parallel then perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-single-slot-v2')); end if;

  -- Keep a retry with the same idempotency key stable.
  if nullif(p_idempotency_key,'') is not null then
    select * into v_existing from public.upi_gateway_payments
      where idempotency_key=p_idempotency_key for update;
    if found then
      if v_existing.order_id <> p_order_id then raise exception 'IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_ORDER'; end if;
      return jsonb_build_object(
        'paymentId',v_existing.id,'orderId',v_existing.order_id,
        'amount',to_char(v_existing.amount_paise/100.0,'FM999999990.00'),
        'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
        'status',v_existing.status,'queuePosition',v_existing.queue_position,
        'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at,
        'transactionReference',v_existing.upi_transaction_ref,'attemptNumber',v_existing.attempt_number);
    end if;
  end if;

  perform public.upi_gateway_tick();

  select * into v_existing from public.upi_gateway_payments
    where order_id=p_order_id and status in ('ACTIVE','PROCESSING')
      and (expires_at is null or expires_at > now())
    order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'paymentId',v_existing.id,'orderId',v_existing.order_id,
      'amount',to_char(v_existing.amount_paise/100.0,'FM999999990.00'),
      'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
      'status',v_existing.status,'queuePosition',0,
      'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at,
      'transactionReference',v_existing.upi_transaction_ref,'attemptNumber',v_existing.attempt_number);
  end if;

  select coalesce(max(attempt_number),0)+1 into v_attempt
    from public.upi_gateway_payments where order_id=p_order_id;
  if not v_parallel and exists (select 1 from public.upi_gateway_payments where merchant_id=p_merchant_id and status in ('ACTIVE','PROCESSING')) then
    v_new_status := 'QUEUED';
    select coalesce(max(queue_position),0)+1 into v_queue from public.upi_gateway_payments where merchant_id=p_merchant_id and status='QUEUED';
    v_expires := null;
  else
    v_new_status := 'ACTIVE';
    v_queue := 0;
    v_expires := now()+make_interval(mins=>v_minutes);
  end if;

  insert into public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,created_at,updated_at,upi_transaction_ref,attempt_number
  ) values (
    p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR',v_new_status,v_queue,v_minutes,
    nullif(p_idempotency_key,''),v_expires,now(),now(),
    replace(p_payment_id::text,'-',''),v_attempt
  ) returning * into v_created;

  return jsonb_build_object(
    'paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise/100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,
    'expiresAt',v_created.expires_at,'completedAt',v_created.completed_at,
    'transactionReference',v_created.upi_transaction_ref,'attemptNumber',v_created.attempt_number);
end;
$$;

-- 4) Prevent amount-only auto-matching from confirming the wrong donor.
-- Notifications are auto-matched only when exactly one eligible payment matches. If multiple
-- active/recent-expired sessions have the same amount, the observation stays UNMATCHED for manual
-- review; the system never guesses which donor paid. Expired payments stay eligible for 30 minutes
-- to accommodate delayed bank notifications, but only while their donation is still pending.
create or replace function public.upi_gateway_prepare_observation(
  p_observation_id uuid,
  p_device_id text,
  p_amount_paise bigint,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_device public.upi_gateway_devices%rowtype;
  v_existing public.upi_gateway_observations%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_observed timestamptz := coalesce(p_observed_at,now());
  v_candidates integer := 0;
  v_grace integer := 30;
begin
  if p_device_id is null or p_bank_reference_number is null then raise exception 'INVALID_OBSERVATION'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 or char_length(p_bank_reference_number) not between 6 and 80 then raise exception 'INVALID_OBSERVATION'; end if;
  if abs(extract(epoch from (now()-v_observed))) > 600 then raise exception 'OBSERVATION_TIME_OUT_OF_RANGE'; end if;

  select * into v_device from public.upi_gateway_devices where id=p_device_id and is_active=true;
  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  select greatest(5,least(120,coalesce(payment_processing_grace_minutes,30))) into v_grace from public.donation_settings where id=true;

  -- These locks protect reconciliation only; payment sessions themselves remain parallel.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-upi-amount:'||p_amount_paise::text));
  perform pg_advisory_xact_lock(hashtext('lokpravaah-upi-observation-match-v2'));

  select * into v_existing from public.upi_gateway_observations
    where bank_reference_number=p_bank_reference_number for update;
  if found and v_existing.matched_payment_id is not null then
    select * into v_payment from public.upi_gateway_payments where id=v_existing.matched_payment_id;
    return jsonb_build_object(
      'matched',true,'duplicate',true,'status',v_payment.status,
      'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
  end if;

  if not found then
    insert into public.upi_gateway_observations(
      id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at
    ) values (
      coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,
      nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());
  else
    update public.upi_gateway_observations set amount_paise=p_amount_paise,
      device_id=p_device_id,sender_vpa=nullif(p_sender_vpa,''),observed_at=v_observed
      where bank_reference_number=p_bank_reference_number;
  end if;

  select count(*)::integer into v_candidates
  from public.upi_gateway_payments p
  join public.donation_intents d on d.order_id=p.order_id
  where p.merchant_id=v_device.merchant_id
    and p.amount_paise=p_amount_paise
    and p.status in ('ACTIVE','EXPIRED')
    and d.status='pending'
    and p.created_at <= v_observed + interval '2 minutes'
    and coalesce(p.expires_at,p.created_at+make_interval(mins=>p.session_minutes)) + make_interval(mins=>v_grace) >= v_observed;

  if v_candidates <> 1 then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED',
      'ambiguous',v_candidates>1,'candidateCount',v_candidates,
      'message',case when v_candidates>1 then 'More than one eligible payment has this amount; manual review is required.' else 'No eligible payment matched; no donation was confirmed.' end);
  end if;

  select p.* into v_payment
  from public.upi_gateway_payments p
  join public.donation_intents d on d.order_id=p.order_id
  where p.merchant_id=v_device.merchant_id
    and p.amount_paise=p_amount_paise
    and p.status in ('ACTIVE','EXPIRED')
    and d.status='pending'
    and p.created_at <= v_observed + interval '2 minutes'
    and coalesce(p.expires_at,p.created_at+make_interval(mins=>p.session_minutes)) + make_interval(mins=>v_grace) >= v_observed
  order by p.created_at asc limit 1 for update of p;

  if not found then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','ambiguous',false,'candidateCount',0);
  end if;

  update public.upi_gateway_payments set status='PROCESSING',bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''),observed_at=v_observed,processing_started_at=now(),updated_at=now()
    where id=v_payment.id and status in ('ACTIVE','EXPIRED');
  if not found then
    return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','ambiguous',true,'candidateCount',v_candidates);
  end if;
  update public.upi_gateway_observations set status='PROCESSING',matched_payment_id=v_payment.id
    where bank_reference_number=p_bank_reference_number;
  return jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING',
    'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
end;
$$;

-- Finalization remains idempotent. Other payment attempts for the same already-paid order are
-- closed; any later incoming credit is left unmatched for manual reconciliation instead of double-counted.
create or replace function public.upi_gateway_finalize_success(
  p_payment_id uuid,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_row public.upi_gateway_payments%rowtype;
begin
  select * into v_row from public.upi_gateway_payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_row.status='SUCCESS' and v_row.bank_reference_number=p_bank_reference_number then
    return jsonb_build_object('paymentId',v_row.id,'status','SUCCESS','alreadyProcessed',true);
  end if;
  if v_row.status<>'PROCESSING' or v_row.bank_reference_number<>p_bank_reference_number then
    raise exception 'PAYMENT_NOT_IN_MATCHED_PROCESSING_STATE';
  end if;

  update public.upi_gateway_payments set status='SUCCESS',queue_position=0,
    sender_vpa=coalesce(nullif(p_sender_vpa,''),sender_vpa),
    observed_at=coalesce(p_observed_at,observed_at),completed_at=now(),updated_at=now()
    where id=p_payment_id returning * into v_row;
  update public.upi_gateway_observations set status='SUCCESS'
    where bank_reference_number=p_bank_reference_number and matched_payment_id=p_payment_id;
  update public.upi_gateway_payments set status='CANCELLED',queue_position=0,updated_at=now()
    where order_id=v_row.order_id and id<>v_row.id and status in ('ACTIVE','QUEUED');
  perform public.upi_gateway_tick();
  return jsonb_build_object('paymentId',v_row.id,'orderId',v_row.order_id,'status','SUCCESS','completedAt',v_row.completed_at);
end;
$$;

-- 5) User/admin ticket support. These tables are independent from payment verification and are
-- safe to re-run. Evidence paths are private and user-scoped.
create table if not exists public.support_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  subcategory text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(category,subcategory)
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
create trigger support_tickets_touch_updated_at before update on public.support_tickets
for each row execute function public.support_touch_updated_at();

alter table public.support_ticket_categories enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_audit enable row level security;
revoke all on public.support_ticket_categories from public,anon,authenticated;
revoke all on public.support_tickets from public,anon,authenticated;
revoke all on public.support_ticket_messages from public,anon,authenticated;
revoke all on public.support_ticket_audit from public,anon,authenticated;
grant select,insert,update,delete on public.support_ticket_categories to authenticated;
grant select,insert,update on public.support_tickets to authenticated;
grant select,insert on public.support_ticket_messages to authenticated;
grant select,insert on public.support_ticket_audit to authenticated;
grant all on public.support_ticket_categories to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_ticket_messages to service_role;
grant all on public.support_ticket_audit to service_role;

drop policy if exists support_categories_read_active on public.support_ticket_categories;
create policy support_categories_read_active on public.support_ticket_categories for select to authenticated
  using (active or public.is_janwatch_admin());
drop policy if exists support_categories_admin_manage on public.support_ticket_categories;
create policy support_categories_admin_manage on public.support_ticket_categories for all to authenticated
  using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_tickets_read_own_or_admin on public.support_tickets;
create policy support_tickets_read_own_or_admin on public.support_tickets for select to authenticated
  using (user_id=auth.uid() or public.is_janwatch_admin());
drop policy if exists support_tickets_create_own on public.support_tickets;
create policy support_tickets_create_own on public.support_tickets for insert to authenticated
  with check (user_id=auth.uid());
drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update on public.support_tickets for update to authenticated
  using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_messages_read_ticket on public.support_ticket_messages;
create policy support_messages_read_ticket on public.support_ticket_messages for select to authenticated using (
  exists(select 1 from public.support_tickets t where t.id=support_ticket_messages.ticket_id
    and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_messages_insert_ticket on public.support_ticket_messages;
create policy support_messages_insert_ticket on public.support_ticket_messages for insert to authenticated with check (
  sender_id=auth.uid() and exists(select 1 from public.support_tickets t where t.id=support_ticket_messages.ticket_id
    and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_audit_read_admin on public.support_ticket_audit;
create policy support_audit_read_admin on public.support_ticket_audit for select to authenticated using (public.is_janwatch_admin());
drop policy if exists support_audit_insert_admin_or_actor on public.support_ticket_audit;
drop policy if exists support_audit_insert_actor on public.support_ticket_audit;
create policy support_audit_insert_actor on public.support_ticket_audit for insert to authenticated
  with check (actor_id=auth.uid() and (public.is_janwatch_admin() or exists(select 1 from public.support_tickets t
    where t.id=support_ticket_audit.ticket_id and t.user_id=auth.uid())));

-- 6) Private user-submitted proof claims for payments that may have been debited but were not
-- confirmed by the gateway. Upload evidence to support-ticket-evidence/<auth-user-id>/... first.
create table if not exists public.donation_payment_claims (
  id uuid primary key default gen_random_uuid(),
  donation_intent_id uuid not null references public.donation_intents(id) on delete cascade,
  order_id text not null references public.donation_intents(order_id) on delete cascade,
  payment_id uuid references public.upi_gateway_payments(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_amount_paise bigint not null check (claimed_amount_paise between 100 and 10000000),
  bank_reference text check (bank_reference is null or char_length(bank_reference) between 6 and 80),
  payment_timestamp timestamptz,
  proof_storage_path text not null,
  user_note text check (user_note is null or char_length(user_note)<=2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donation_claim_proof_owner_path check (left(proof_storage_path,char_length(user_id::text)+1)=user_id::text||'/')
);
create index if not exists donation_payment_claims_queue_idx
  on public.donation_payment_claims(status,created_at desc);
create index if not exists donation_payment_claims_user_idx
  on public.donation_payment_claims(user_id,created_at desc);

create or replace function public.donation_manual_payment_review_enabled()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select manual_payment_review_enabled from public.donation_settings where id=true),false) $$;
create or replace function public.donation_proof_upload_enabled()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select payment_proof_upload_enabled from public.donation_settings where id=true),false) $$;
revoke all on function public.donation_manual_payment_review_enabled() from public,anon;
revoke all on function public.donation_proof_upload_enabled() from public,anon;
grant execute on function public.donation_manual_payment_review_enabled() to authenticated;
grant execute on function public.donation_proof_upload_enabled() to authenticated;

create table if not exists public.donation_payment_claim_audit (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.donation_payment_claims(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.donation_payment_claims enable row level security;
alter table public.donation_payment_claim_audit enable row level security;
revoke all on public.donation_payment_claims from public,anon,authenticated;
revoke all on public.donation_payment_claim_audit from public,anon,authenticated;
grant select,insert on public.donation_payment_claims to authenticated;
grant all on public.donation_payment_claims to service_role;
grant all on public.donation_payment_claim_audit to service_role;

create or replace function public.donation_payment_claim_insert_allowed(
  p_user_id uuid, p_donation_intent_id uuid, p_order_id text, p_payment_id uuid,
  p_claimed_amount_paise bigint, p_proof_storage_path text
)
returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,auth,pg_temp
as $$
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then return false; end if;
  if not public.donation_manual_payment_review_enabled() or not public.donation_proof_upload_enabled() then return false; end if;
  if p_proof_storage_path is null or left(p_proof_storage_path,char_length(p_user_id::text)+1)<>p_user_id::text||'/' then return false; end if;
  if not exists (
    select 1 from public.donation_intents d
    where d.id=p_donation_intent_id and d.order_id=p_order_id
      and d.amount_paise=p_claimed_amount_paise and d.status in ('pending','failed','expired','suspicious')
      and (d.donor_user_id is null or d.donor_user_id=p_user_id)
  ) then return false; end if;
  if p_payment_id is not null and not exists (
    select 1 from public.upi_gateway_payments p
    where p.id=p_payment_id and p.order_id=p_order_id and p.amount_paise=p_claimed_amount_paise
  ) then return false; end if;
  return true;
end;
$$;
revoke all on function public.donation_payment_claim_insert_allowed(uuid,uuid,text,uuid,bigint,text) from public,anon;
grant execute on function public.donation_payment_claim_insert_allowed(uuid,uuid,text,uuid,bigint,text) to authenticated;

drop policy if exists donation_payment_claims_read_owner_admin on public.donation_payment_claims;
create policy donation_payment_claims_read_owner_admin on public.donation_payment_claims
  for select to authenticated using (user_id=auth.uid() or public.is_janwatch_admin());
drop policy if exists donation_payment_claims_insert_owner on public.donation_payment_claims;
create policy donation_payment_claims_insert_owner on public.donation_payment_claims
  for insert to authenticated with check (public.donation_payment_claim_insert_allowed(
    donation_payment_claims.user_id,donation_payment_claims.donation_intent_id,donation_payment_claims.order_id,
    donation_payment_claims.payment_id,donation_payment_claims.claimed_amount_paise,donation_payment_claims.proof_storage_path));
drop policy if exists donation_payment_claims_admin_update on public.donation_payment_claims;
create policy donation_payment_claims_admin_update on public.donation_payment_claims
  for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists donation_payment_claim_audit_admin_read on public.donation_payment_claim_audit;
create policy donation_payment_claim_audit_admin_read on public.donation_payment_claim_audit
  for select to authenticated using (public.is_janwatch_admin());

-- Reassert private evidence storage policies, without making screenshots public.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('support-ticket-evidence','support-ticket-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists support_evidence_upload_authenticated on storage.objects;
create policy support_evidence_upload_authenticated on storage.objects for insert to authenticated
  with check (bucket_id='support-ticket-evidence' and (storage.foldername(name))[1]=auth.uid()::text and public.donation_proof_upload_enabled());
drop policy if exists support_evidence_read_owner_admin on storage.objects;
create policy support_evidence_read_owner_admin on storage.objects for select to authenticated
  using (bucket_id='support-ticket-evidence' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_janwatch_admin()));

-- 7) Admin-only approve/reject control. Approval requires a bank reference and an actual manual
-- bank-statement check by an administrator. A screenshot alone is not automatic payment proof.
create or replace function public.janwatch_admin_review_donation_payment_claim(
  p_claim_id uuid,
  p_decision text,
  p_review_note text default null,
  p_bank_reference text default null
)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp
as $$
declare
  v_claim public.donation_payment_claims%rowtype;
  v_donation public.donation_intents%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_reference text;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator permission required'; end if;
  if p_decision is null or p_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into v_claim from public.donation_payment_claims where id=p_claim_id for update;
  if not found then raise exception 'Payment claim not found'; end if;
  if v_claim.status <> 'pending' then raise exception 'This claim has already been reviewed'; end if;
  select * into v_donation from public.donation_intents where id=v_claim.donation_intent_id for update;
  if not found then raise exception 'Donation intent not found'; end if;

  if p_decision='reject' then
    update public.donation_payment_claims set status='rejected',admin_review_note=left(nullif(btrim(p_review_note),''),2000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where id=p_claim_id;
    insert into public.donation_payment_claim_audit(claim_id,actor_id,action,details)
      values(p_claim_id,auth.uid(),'rejected',jsonb_build_object('note',left(nullif(btrim(p_review_note),''),2000)));
    return jsonb_build_object('status','rejected','claimId',p_claim_id,'message','Claim rejected; donation totals were not changed.');
  end if;

  v_reference := nullif(btrim(coalesce(p_bank_reference,v_claim.bank_reference)),'');
  if v_reference is null or v_reference !~ '^[A-Za-z0-9_-]{6,80}$' then
    raise exception 'A valid bank UTR/reference is required to approve this claim';
  end if;
  if v_donation.amount_paise <> v_claim.claimed_amount_paise then raise exception 'Claimed amount does not match donation intent'; end if;
  if exists(select 1 from public.donation_intents d where d.utr=v_reference and d.id<>v_donation.id) then
    raise exception 'This bank reference is already assigned to another donation';
  end if;

  if v_donation.status='succeeded' then
    if v_donation.utr is distinct from v_reference then raise exception 'Donation is already verified with a different bank reference'; end if;
  else
    if v_donation.status not in ('pending','failed','expired','suspicious') then raise exception 'Donation is not eligible for manual verification'; end if;
    if v_claim.payment_id is not null then
      select * into v_payment from public.upi_gateway_payments where id=v_claim.payment_id for update;
      if not found then raise exception 'Linked payment attempt not found'; end if;
    else
      select * into v_payment from public.upi_gateway_payments where order_id=v_claim.order_id
        order by created_at desc limit 1 for update;
    end if;
    if found then
      if v_payment.order_id<>v_claim.order_id or v_payment.amount_paise<>v_claim.claimed_amount_paise then raise exception 'Payment attempt does not match this donation'; end if;
      if v_payment.bank_reference_number is not null and v_payment.bank_reference_number<>v_reference then
        raise exception 'Gateway observed a different bank reference; reconcile this conflict before approval';
      end if;
      if exists(select 1 from public.upi_gateway_payments p where p.bank_reference_number=v_reference and p.id<>v_payment.id) then
        raise exception 'This bank reference is already assigned to another payment';
      end if;
      update public.upi_gateway_payments set status='SUCCESS',bank_reference_number=v_reference,
        queue_position=0,completed_at=coalesce(completed_at,now()),updated_at=now(),
        failure_code=null,failure_message=null where id=v_payment.id;
      update public.upi_gateway_payments set status='CANCELLED',queue_position=0,updated_at=now()
        where order_id=v_claim.order_id and id<>v_payment.id and status in ('ACTIVE','QUEUED');
    end if;
    update public.donation_intents set status='succeeded',utr=v_reference,verified_at=now(),
      gateway_payment_id=coalesce(v_payment.id::text,gateway_payment_id),updated_at=now()
      where id=v_donation.id;
  end if;

  update public.donation_payment_claims set status='approved',bank_reference=v_reference,
    admin_review_note=left(nullif(btrim(p_review_note),''),2000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=p_claim_id;
  insert into public.donation_payment_claim_audit(claim_id,actor_id,action,details)
    values(p_claim_id,auth.uid(),'approved',jsonb_build_object('bank_reference',v_reference,'note',left(nullif(btrim(p_review_note),''),2000)));
  return jsonb_build_object('status','approved','claimId',p_claim_id,'orderId',v_claim.order_id,'message','Donation manually verified by an administrator.');
end;
$$;
revoke all on function public.janwatch_admin_review_donation_payment_claim(uuid,text,text,text) from public,anon;
grant execute on function public.janwatch_admin_review_donation_payment_claim(uuid,text,text,text) to authenticated;

-- 8) Super-admin-only payment control settings. The React admin panel must call this RPC to make
-- the new timer/review controls editable; adding SQL columns alone does not add UI controls.
create or replace function public.janwatch_super_admin_update_donation_payment_controls(
  p_payment_session_minutes integer default null,
  p_payment_processing_grace_minutes integer default null,
  p_manual_payment_review_enabled boolean default null,
  p_payment_proof_upload_enabled boolean default null,
  p_allow_parallel_payment_sessions boolean default null
)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp
as $$
declare v_role text;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'')<>'super_admin' then raise exception 'Super administrator permission required'; end if;
  if p_payment_session_minutes is not null and p_payment_session_minutes not between 5 and 30 then raise exception 'Session timer must be 5-30 minutes'; end if;
  if p_payment_processing_grace_minutes is not null and p_payment_processing_grace_minutes not between 5 and 120 then raise exception 'Grace period must be 5-120 minutes'; end if;

  update public.donation_settings set
    payment_session_minutes=coalesce(p_payment_session_minutes,payment_session_minutes),
    payment_processing_grace_minutes=coalesce(p_payment_processing_grace_minutes,payment_processing_grace_minutes),
    manual_payment_review_enabled=coalesce(p_manual_payment_review_enabled,manual_payment_review_enabled),
    payment_proof_upload_enabled=coalesce(p_payment_proof_upload_enabled,payment_proof_upload_enabled),
    allow_parallel_payment_sessions=coalesce(p_allow_parallel_payment_sessions,allow_parallel_payment_sessions),
    updated_at=now(),updated_by=auth.uid()
  where id=true;

  return (select jsonb_build_object('status','saved','settings',to_jsonb(s)-'id') from public.donation_settings s where id=true);
end;
$$;
revoke all on function public.janwatch_super_admin_update_donation_payment_controls(integer,integer,boolean,boolean,boolean) from public,anon;
grant execute on function public.janwatch_super_admin_update_donation_payment_controls(integer,integer,boolean,boolean,boolean) to authenticated;

-- The existing janwatch_admin_set_donation_visibility() safely hides/restores a verified donation
-- without deleting the financial audit trail; keep using it instead of hard-deleting paid records.

revoke all on function public.upi_gateway_tick() from public,anon,authenticated;
revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) from public,anon,authenticated;
revoke all on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.upi_gateway_finalize_success(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.upi_gateway_tick() to service_role;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) to service_role;
grant execute on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) to service_role;
grant execute on function public.upi_gateway_finalize_success(uuid,text,text,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;

-- Post-run checks: all five should return table names; the active-slot index should be absent.
select to_regclass('public.donation_intents') as donation_intents,
       to_regclass('public.donation_settings') as donation_settings,
       to_regclass('public.upi_gateway_payments') as upi_gateway_payments,
       to_regclass('public.donation_payment_claims') as donation_payment_claims,
       to_regclass('public.support_tickets') as support_tickets,
       to_regclass('public.upi_gateway_single_active_slot_uq') as old_single_active_index;
