-- LokPravaah Cloudflare Worker gateway storage.
-- Apply AFTER supabase/lokpravaah_donations.sql in the SAME Supabase project.
-- The Worker uses SUPABASE_SERVICE_ROLE_KEY server-side only. Never put that key in VITE_* variables.

create table if not exists public.upi_gateway_payments (
  id uuid primary key,
  merchant_id text not null default '00000000-0000-0000-0000-000000000001',
  order_id text not null unique references public.donation_intents(order_id) on delete cascade,
  amount_paise bigint not null check (amount_paise between 100 and 10000000),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null check (status in ('ACTIVE','QUEUED','PROCESSING','SUCCESS','FAILED','EXPIRED','CANCELLED','SUSPICIOUS')),
  queue_position integer not null default 0 check (queue_position >= 0),
  session_minutes integer not null default 15 check (session_minutes between 5 and 30),
  idempotency_key text,
  bank_reference_number text unique,
  sender_vpa text,
  observed_at timestamptz,
  expires_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists upi_gateway_payments_idempotency_uq
  on public.upi_gateway_payments(idempotency_key) where idempotency_key is not null;
create index if not exists upi_gateway_payments_queue_idx
  on public.upi_gateway_payments(merchant_id, status, created_at);
create index if not exists upi_gateway_payments_status_idx
  on public.upi_gateway_payments(status, expires_at);
-- Deliberately no single-active-slot index: checkout sessions are independent across donors.

create table if not exists public.upi_gateway_devices (
  id text primary key,
  merchant_id text not null default '00000000-0000-0000-0000-000000000001',
  device_name text not null,
  device_model text not null,
  signing_key text not null,
  is_active boolean not null default true,
  last_heartbeat_at timestamptz,
  last_observation_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.upi_gateway_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  merchant_id text not null default '00000000-0000-0000-0000-000000000001',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists upi_gateway_pairing_expiry_idx
  on public.upi_gateway_pairing_tokens(expires_at) where used_at is null;

create table if not exists public.upi_gateway_observations (
  id uuid primary key,
  device_id text not null references public.upi_gateway_devices(id),
  amount_paise bigint not null check (amount_paise between 100 and 10000000),
  bank_reference_number text not null unique check (char_length(bank_reference_number) between 6 and 80),
  sender_vpa text,
  observed_at timestamptz not null,
  status text not null default 'UNMATCHED' check (status in ('UNMATCHED','PROCESSING','SUCCESS','DUPLICATE')),
  matched_payment_id uuid references public.upi_gateway_payments(id),
  created_at timestamptz not null default now()
);
create index if not exists upi_gateway_observations_match_idx
  on public.upi_gateway_observations(status, amount_paise, observed_at desc);

alter table public.upi_gateway_payments enable row level security;
alter table public.upi_gateway_devices enable row level security;
alter table public.upi_gateway_pairing_tokens enable row level security;
alter table public.upi_gateway_observations enable row level security;
revoke all on public.upi_gateway_payments from public, anon, authenticated;
revoke all on public.upi_gateway_devices from public, anon, authenticated;
revoke all on public.upi_gateway_pairing_tokens from public, anon, authenticated;
revoke all on public.upi_gateway_observations from public, anon, authenticated;
grant all on public.upi_gateway_payments to service_role;
grant all on public.upi_gateway_devices to service_role;
grant all on public.upi_gateway_pairing_tokens to service_role;
grant all on public.upi_gateway_observations to service_role;

-- The advisory lock is only held for the short database transaction used to match an observer event.
create or replace function public.upi_gateway_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next public.upi_gateway_payments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  update public.upi_gateway_payments
    set status = 'EXPIRED', updated_at = now(), queue_position = 0
    where status = 'ACTIVE' and expires_at is not null and expires_at <= now();

  if not exists (select 1 from public.upi_gateway_payments where status in ('ACTIVE','PROCESSING')) then
    select * into v_next
      from public.upi_gateway_payments
      where status = 'QUEUED'
      order by created_at asc
      limit 1
      for update skip locked;
    if found then
      update public.upi_gateway_payments
        set status = 'ACTIVE', queue_position = 0,
            expires_at = now() + make_interval(mins => session_minutes), updated_at = now()
        where id = v_next.id;
    end if;
  end if;

  with ranked as (
    select id, row_number() over (order by created_at asc) as rn
    from public.upi_gateway_payments where status = 'QUEUED'
  )
  update public.upi_gateway_payments p set queue_position = ranked.rn::integer, updated_at = now()
    from ranked where p.id = ranked.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text default null,
  p_session_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_status text;
  v_expires timestamptz;
  v_queue integer := 0;
  v_created public.upi_gateway_payments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_donation from public.donation_intents where order_id = p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then
    raise exception 'DONATION_AMOUNT_MISMATCH';
  end if;

  select * into v_existing from public.upi_gateway_payments where order_id = p_order_id;
  if found then
    return jsonb_build_object(
      'paymentId', v_existing.id, 'orderId', v_existing.order_id,
      'amount', to_char(v_existing.amount_paise / 100.0, 'FM999999990.00'),
      'amountPaise', v_existing.amount_paise::text, 'currency', v_existing.currency,
      'status', v_existing.status, 'queuePosition', v_existing.queue_position,
      'expiresAt', v_existing.expires_at, 'completedAt', v_existing.completed_at
    );
  end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_merchant_id <> '00000000-0000-0000-0000-000000000001' then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;

  perform public.upi_gateway_tick();
  if exists (select 1 from public.upi_gateway_payments where merchant_id = p_merchant_id and status in ('ACTIVE','PROCESSING')) then
    v_status := 'QUEUED';
    v_expires := null;
    select coalesce(max(queue_position),0) + 1 into v_queue
      from public.upi_gateway_payments where merchant_id = p_merchant_id and status = 'QUEUED';
  else
    v_status := 'ACTIVE';
    v_expires := now() + make_interval(mins => greatest(5, least(30, coalesce(p_session_minutes,15))));
    v_queue := 0;
  end if;

  insert into public.upi_gateway_payments(
    id, merchant_id, order_id, amount_paise, currency, status, queue_position,
    session_minutes, idempotency_key, expires_at, created_at, updated_at
  ) values (
    p_payment_id, p_merchant_id, p_order_id, p_amount_paise, 'INR', v_status, v_queue,
    greatest(5, least(30, coalesce(p_session_minutes,15))), nullif(p_idempotency_key,''), v_expires, now(), now()
  ) returning * into v_created;
  return jsonb_build_object(
    'paymentId', v_created.id, 'orderId', v_created.order_id,
    'amount', to_char(v_created.amount_paise / 100.0, 'FM999999990.00'),
    'amountPaise', v_created.amount_paise::text, 'currency', v_created.currency,
    'status', v_created.status, 'queuePosition', v_created.queue_position,
    'expiresAt', v_created.expires_at, 'completedAt', v_created.completed_at
  );
end;
$$;

create or replace function public.upi_gateway_cancel_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.upi_gateway_payments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_row from public.upi_gateway_payments where id = p_payment_id for update;
  if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
  if v_row.status = 'QUEUED' then
    update public.upi_gateway_payments set status = 'CANCELLED', queue_position = 0, updated_at = now()
      where id = p_payment_id;
    perform public.upi_gateway_tick();
    return jsonb_build_object('paymentId',v_row.id,'orderId',v_row.order_id,'status','CANCELLED');
  end if;
  if v_row.status = 'ACTIVE' then
    -- A browser closing the dialog is not proof that the payer did not transfer money.
    -- Keep the active slot through its expiry so a late signed bank notification can still match.
    return jsonb_build_object('paymentId',v_row.id,'orderId',v_row.order_id,'status','CANCELLED','retainedForVerification',true);
  end if;
  return jsonb_build_object('error','NOT_CANCELLABLE');
end;
$$;

create or replace function public.upi_gateway_pair_device(
  p_token_hash text,
  p_device_id text,
  p_signing_key text,
  p_merchant_id text,
  p_device_name text,
  p_device_model text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_token public.upi_gateway_pairing_tokens%rowtype;
begin
  select * into v_token from public.upi_gateway_pairing_tokens
    where token_hash = p_token_hash and used_at is null for update;
  if not found or v_token.expires_at <= now() or (p_expires_at is not null and (p_expires_at < now() or p_expires_at > v_token.expires_at)) then
    return jsonb_build_object('paired',false);
  end if;
  if v_token.merchant_id <> p_merchant_id then return jsonb_build_object('paired',false); end if;
  update public.upi_gateway_pairing_tokens set used_at = now() where id = v_token.id;
  insert into public.upi_gateway_devices(id,merchant_id,device_name,device_model,signing_key,is_active,last_heartbeat_at,created_at)
    values(p_device_id,p_merchant_id,coalesce(nullif(p_device_name,''),'Android Observer'),coalesce(nullif(p_device_model,''),'Android Device'),p_signing_key,true,now(),now());
  return jsonb_build_object('paired',true,'deviceId',p_device_id);
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
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_device from public.upi_gateway_devices where id = p_device_id and is_active = true;
  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 or p_bank_reference_number is null or char_length(p_bank_reference_number) not between 6 and 80 then
    raise exception 'INVALID_OBSERVATION';
  end if;
  if abs(extract(epoch from (now() - v_observed))) > 600 then
    raise exception 'OBSERVATION_TIME_OUT_OF_RANGE';
  end if;

  select * into v_existing from public.upi_gateway_observations where bank_reference_number = p_bank_reference_number;
  if found then
    if v_existing.matched_payment_id is null then
      return jsonb_build_object('matched',false,'duplicate',true,'status','DUPLICATE');
    end if;
    select * into v_payment from public.upi_gateway_payments where id = v_existing.matched_payment_id;
    return jsonb_build_object(
      'matched',true,'duplicate',true,'status',v_payment.status,
      'paymentId',v_payment.id,'orderId',v_payment.order_id,
      'amountPaise',v_payment.amount_paise::text
    );
  end if;

  insert into public.upi_gateway_observations(id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at)
    values(coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());

  select * into v_payment from public.upi_gateway_payments p
    where p.merchant_id = v_device.merchant_id
      and p.status = 'ACTIVE'
      and p.amount_paise = p_amount_paise
      and p.created_at <= v_observed
      and p.expires_at >= v_observed
    order by p.created_at asc
    limit 1
    for update;
  if not found then return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED'); end if;

  update public.upi_gateway_payments set status='PROCESSING', bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''), observed_at=v_observed, processing_started_at=now(), updated_at=now()
    where id=v_payment.id;
  update public.upi_gateway_observations set status='PROCESSING', matched_payment_id=v_payment.id
    where bank_reference_number=p_bank_reference_number;
  return jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING',
    'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
end;
$$;

create or replace function public.upi_gateway_finalize_success(
  p_payment_id uuid,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.upi_gateway_payments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_row from public.upi_gateway_payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_row.status='SUCCESS' and v_row.bank_reference_number=p_bank_reference_number then
    return jsonb_build_object('paymentId',v_row.id,'status','SUCCESS','alreadyProcessed',true);
  end if;
  if v_row.status<>'PROCESSING' or v_row.bank_reference_number<>p_bank_reference_number then
    raise exception 'PAYMENT_NOT_IN_MATCHED_PROCESSING_STATE';
  end if;
  update public.upi_gateway_payments set status='SUCCESS', queue_position=0,
    sender_vpa=coalesce(nullif(p_sender_vpa,''),sender_vpa),
    observed_at=coalesce(p_observed_at,observed_at), completed_at=now(), updated_at=now()
    where id=p_payment_id returning * into v_row;
  update public.upi_gateway_observations set status='SUCCESS' where bank_reference_number=p_bank_reference_number and matched_payment_id=p_payment_id;
  perform public.upi_gateway_tick();
  return jsonb_build_object('paymentId',v_row.id,'orderId',v_row.order_id,'status','SUCCESS','completedAt',v_row.completed_at);
end;
$$;

revoke all on function public.upi_gateway_tick() from public, anon, authenticated;
revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) from public, anon, authenticated;
revoke all on function public.upi_gateway_cancel_payment(uuid) from public, anon, authenticated;
revoke all on function public.upi_gateway_pair_device(text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.upi_gateway_finalize_success(uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.upi_gateway_tick() to service_role;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) to service_role;
grant execute on function public.upi_gateway_cancel_payment(uuid) to service_role;
grant execute on function public.upi_gateway_pair_device(text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) to service_role;
grant execute on function public.upi_gateway_finalize_success(uuid,text,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
