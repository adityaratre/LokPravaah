-- Fix legacy/new RPC overload ambiguity for UPI payment-session creation.
-- Apply after lokpravaah_cloudflare_gateway.sql on existing projects.
DROP FUNCTION IF EXISTS public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer);
DROP FUNCTION IF EXISTS public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer, text, text);

CREATE FUNCTION public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text,
  p_session_minutes integer,
  p_receiver_vpa text,
  p_receiver_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer;
  v_db_minutes integer;
  v_vpa text := nullif(btrim(p_receiver_vpa),'');
  v_name text := nullif(btrim(p_receiver_name),'');
  v_configured_merchant text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-observation-v2'));
  SELECT * INTO v_donation FROM public.donation_intents WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DONATION_INTENT_NOT_FOUND'; END IF;
  IF v_donation.amount_paise <> p_amount_paise OR v_donation.currency <> 'INR' THEN
    RAISE EXCEPTION 'DONATION_AMOUNT_MISMATCH';
  END IF;

  SELECT * INTO v_existing FROM public.upi_gateway_payments WHERE order_id=p_order_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'paymentId',v_existing.id,'orderId',v_existing.order_id,
      'amount',to_char(v_existing.amount_paise/100.0,'FM999999990.00'),
      'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
      'status',v_existing.status,'queuePosition',v_existing.queue_position,
      'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at
    );
  END IF;
  IF v_donation.status <> 'pending' THEN RAISE EXCEPTION 'DONATION_INTENT_NOT_PENDING'; END IF;
  IF p_amount_paise < 100 OR p_amount_paise > 10000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT nullif(btrim(gateway_merchant_key),'') INTO v_configured_merchant
  FROM public.donation_settings WHERE id=true;
  v_configured_merchant := coalesce(v_configured_merchant, '00000000-0000-0000-0000-000000000001');
  IF p_merchant_id IS DISTINCT FROM v_configured_merchant THEN RAISE EXCEPTION 'MERCHANT_NOT_SUPPORTED'; END IF;
  IF v_vpa IS NULL OR v_vpa !~ '^[^[:space:]@]+@[^[:space:]@]+$' OR v_name IS NULL OR char_length(v_name)>80 THEN
    RAISE EXCEPTION 'UPI_RECEIVER_NOT_CONFIGURED';
  END IF;

  SELECT payment_session_minutes INTO v_db_minutes FROM public.donation_settings WHERE id=true;
  v_minutes := greatest(5,least(30,coalesce(v_db_minutes,p_session_minutes,15)));
  INSERT INTO public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,receiver_vpa,receiver_name,created_at,updated_at
  ) VALUES(
    p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),v_vpa,v_name,now(),now()
  ) RETURNING * INTO v_created;

  RETURN jsonb_build_object(
    'paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise/100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,
    'completedAt',v_created.completed_at
  );
END;
$function$;

CREATE FUNCTION public.upi_gateway_create_payment(
  p_payment_id uuid,
  p_order_id text,
  p_amount_paise bigint,
  p_merchant_id text,
  p_idempotency_key text DEFAULT NULL::text,
  p_session_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receiver jsonb;
BEGIN
  -- Compatibility for deployed Workers sending the original six parameters.
  v_receiver := public.upi_gateway_get_receiver_settings();
  RETURN public.upi_gateway_create_payment(
    p_payment_id,p_order_id,p_amount_paise,p_merchant_id,p_idempotency_key,p_session_minutes,
    nullif(btrim(v_receiver->>'receivingVpa'),''),
    nullif(btrim(v_receiver->>'payeeName'),'')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_create_payment(uuid, text, bigint, text, text, integer) TO service_role;
