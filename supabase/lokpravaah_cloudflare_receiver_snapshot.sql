-- Receiver snapshot compatibility migration for the Cloudflare UPI gateway.
-- Apply after lokpravaah_cloudflare_gateway.sql. New payment sessions store the exact
-- beneficiary shown in the QR/intent, so later admin setting changes cannot redirect them.
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
  v_minutes integer := greatest(5, least(30, coalesce(p_session_minutes,15)));
  v_vpa text := btrim(coalesce(p_receiver_vpa,''));
  v_name text := btrim(coalesce(p_receiver_name,''));
  v_created public.upi_gateway_payments%rowtype;
begin
  if v_vpa !~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$'
     or v_name = '' or char_length(v_name) > 99 then
    raise exception 'INVALID_RECEIVER_CONFIGURATION';
  end if;

  select * into v_donation
    from public.donation_intents
    where order_id = p_order_id
    for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then
    raise exception 'DONATION_AMOUNT_MISMATCH';
  end if;

  -- Serialize only the brief payment-row mutation window and observation matching.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
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
  insert into public.upi_gateway_payments(
    id, merchant_id, order_id, amount_paise, currency, status, queue_position,
    session_minutes, idempotency_key, expires_at, receiver_vpa, receiver_name, created_at, updated_at
  ) values (
    p_payment_id, p_merchant_id, p_order_id, p_amount_paise, 'INR', 'ACTIVE', 0,
    v_minutes, nullif(p_idempotency_key,''), now() + make_interval(mins => v_minutes),
    v_vpa, v_name, now(), now()
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

revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer,text,text) to service_role;
notify pgrst, 'reload schema';
