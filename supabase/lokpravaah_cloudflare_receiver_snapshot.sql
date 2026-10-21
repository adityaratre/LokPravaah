-- Receiver snapshot compatibility migration for the Cloudflare UPI gateway.
-- Safe to re-apply after lokpravaah_cloudflare_gateway.sql.
-- Existing production migration uses this receiver-aware overload and a six-argument
-- compatibility wrapper. Keep both definitions in source control so fresh installs match.

alter table public.upi_gateway_payments
  add column if not exists receiver_vpa text,
  add column if not exists receiver_name text;

create or replace function public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text,
  p_session_minutes integer,
  p_receiver_vpa text,
  p_receiver_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  -- Serialize candidate matching and payment session creation, not donor checkout time.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-observation-v2'));
  select * into v_donation from public.donation_intents where order_id=p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then
    raise exception 'DONATION_AMOUNT_MISMATCH';
  end if;

  select * into v_existing from public.upi_gateway_payments where order_id=p_order_id limit 1;
  if found then
    return jsonb_build_object(
      'paymentId',v_existing.id,'orderId',v_existing.order_id,
      'amount',to_char(v_existing.amount_paise/100.0,'FM999999990.00'),
      'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
      'status',v_existing.status,'queuePosition',v_existing.queue_position,
      'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at
    );
  end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;

  select nullif(btrim(gateway_merchant_key),'') into v_configured_merchant
    from public.donation_settings where id=true;
  v_configured_merchant := coalesce(v_configured_merchant, '00000000-0000-0000-0000-000000000001');
  if p_merchant_id is distinct from v_configured_merchant then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;
  if v_vpa is null or v_vpa !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or v_name is null or char_length(v_name)>80 then
    raise exception 'UPI_RECEIVER_NOT_CONFIGURED';
  end if;

  select payment_session_minutes into v_db_minutes from public.donation_settings where id=true;
  v_minutes := greatest(5,least(30,coalesce(v_db_minutes,p_session_minutes,15)));
  insert into public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,receiver_vpa,receiver_name,created_at,updated_at
  ) values(
    p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),v_vpa,v_name,now(),now()
  ) returning * into v_created;

  return jsonb_build_object(
    'paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise/100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,
    'completedAt',v_created.completed_at
  );
end;
$$;

-- Keep old clients that send six named arguments working, but route them through
-- the same receiver snapshot implementation rather than a second independent path.
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
  v_receiver jsonb;
begin
  v_receiver := public.upi_gateway_get_receiver_settings();
  return public.upi_gateway_create_payment(
    p_payment_id,p_order_id,p_amount_paise,p_merchant_id,p_idempotency_key,p_session_minutes,
    nullif(btrim(v_receiver->>'receivingVpa'),''),
    nullif(btrim(v_receiver->>'payeeName'),'')
  );
end;
$$;

revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) from public, anon, authenticated;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) to service_role;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) to service_role;
notify pgrst, 'reload schema';
