-- LokPravaah payment reliability + manual payment evidence review
-- Apply AFTER lokpravaah_donations.sql, lokpravaah_cloudflare_gateway.sql,
-- and lokpravaah_support_and_concurrency_fix.sql, in the same Supabase project.
-- Take a database backup first. This does not itself enable accepting real donations.

-- 1) Remove the obsolete one-active-payment-per-merchant index. That index conflicts
-- with independent concurrent payment sessions and was the cause of session creation failures.
DROP INDEX IF EXISTS public.upi_gateway_single_active_slot_uq;

-- 2) Make the payment session timer configurable in Admin → Donations & UPI.
ALTER TABLE public.donation_settings
  ADD COLUMN IF NOT EXISTS payment_session_minutes integer NOT NULL DEFAULT 15;
ALTER TABLE public.donation_settings
  DROP CONSTRAINT IF EXISTS donation_settings_payment_session_minutes_check;
ALTER TABLE public.donation_settings
  ADD CONSTRAINT donation_settings_payment_session_minutes_check
  CHECK (payment_session_minutes BETWEEN 5 AND 30);

-- Useful diagnostics. This checks actual schema facts, not only whether vars are non-empty.
CREATE OR REPLACE FUNCTION public.upi_gateway_health_diagnostics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'available', true,
    'singleActiveIndexPresent', EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'upi_gateway_single_active_slot_uq'
    ),
    'activeCount', (SELECT count(*) FROM public.upi_gateway_payments WHERE status = 'ACTIVE'),
    'processingCount', (SELECT count(*) FROM public.upi_gateway_payments WHERE status = 'PROCESSING'),
    'queuedCount', (SELECT count(*) FROM public.upi_gateway_payments WHERE status = 'QUEUED')
  );
$$;
REVOKE ALL ON FUNCTION public.upi_gateway_health_diagnostics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_health_diagnostics() TO service_role;

-- Payment sessions do not block one another. Expire past-due sessions and promote legacy
-- queued sessions independently. The brief advisory lock only serializes this housekeeping;
-- payment creation does not need a single global active slot.
CREATE OR REPLACE FUNCTION public.upi_gateway_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_minutes integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-housekeeping-v2'));
  UPDATE public.upi_gateway_payments
    SET status = 'EXPIRED', updated_at = now(), queue_position = 0
    WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now();

  SELECT payment_session_minutes INTO v_minutes
    FROM public.donation_settings WHERE id = true;
  v_minutes := greatest(5, least(30, coalesce(v_minutes, 15)));

  UPDATE public.upi_gateway_payments p
    SET status = 'ACTIVE', queue_position = 0,
        session_minutes = v_minutes,
        expires_at = now() + make_interval(mins => v_minutes), updated_at = now()
    WHERE p.status = 'QUEUED';
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Create independent active sessions; read the session duration from admin settings.
CREATE OR REPLACE FUNCTION public.upi_gateway_create_payment(
  p_payment_id uuid, p_order_id text, p_amount_paise bigint, p_merchant_id text,
  p_idempotency_key text DEFAULT NULL, p_session_minutes integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer;
BEGIN
  -- Lock only the specific donation intent; different donors may check out concurrently.
  SELECT * INTO v_donation FROM public.donation_intents WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DONATION_INTENT_NOT_FOUND'; END IF;
  IF v_donation.amount_paise <> p_amount_paise OR v_donation.currency <> 'INR' THEN RAISE EXCEPTION 'DONATION_AMOUNT_MISMATCH'; END IF;

  SELECT * INTO v_existing FROM public.upi_gateway_payments WHERE order_id = p_order_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'paymentId',v_existing.id,'orderId',v_existing.order_id,
      'amount',to_char(v_existing.amount_paise / 100.0,'FM999999990.00'),
      'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
      'status',v_existing.status,'queuePosition',v_existing.queue_position,
      'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at
    );
  END IF;
  IF v_donation.status <> 'pending' THEN RAISE EXCEPTION 'DONATION_INTENT_NOT_PENDING'; END IF;
  IF p_amount_paise < 100 OR p_amount_paise > 10000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_merchant_id <> '00000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'MERCHANT_NOT_SUPPORTED'; END IF;

  SELECT payment_session_minutes INTO v_minutes FROM public.donation_settings WHERE id = true;
  v_minutes := greatest(5, least(30, coalesce(v_minutes, p_session_minutes, 15)));
  INSERT INTO public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,created_at,updated_at
  ) VALUES (
    p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),now(),now()
  ) RETURNING * INTO v_created;
  RETURN jsonb_build_object(
    'paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise / 100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,'completedAt',v_created.completed_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) TO service_role;

-- 3) Safer bank-notification matching. A transaction is auto-matched only if exactly ONE
-- payment with this amount overlaps the timestamp window. Equal-amount concurrent donations
-- remain unmatched for admin/manual review instead of confirming the wrong donor.
CREATE OR REPLACE FUNCTION public.upi_gateway_prepare_observation(
  p_observation_id uuid, p_device_id text, p_amount_paise bigint,
  p_bank_reference_number text, p_sender_vpa text, p_observed_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.upi_gateway_devices%rowtype;
  v_existing public.upi_gateway_observations%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_observed timestamptz := coalesce(p_observed_at, now());
  v_candidate_count integer := 0;
BEGIN
  -- Keep one bank-reference match operation atomic without queueing the actual donor checkouts.
  PERFORM pg_advisory_xact_lock(hashtext('lokpravaah-upi-observation-match-v2'));
  SELECT * INTO v_device FROM public.upi_gateway_devices WHERE id=p_device_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_NOT_AUTHORIZED'; END IF;
  IF p_amount_paise < 100 OR p_amount_paise > 10000000 OR p_bank_reference_number IS NULL OR char_length(p_bank_reference_number) NOT BETWEEN 6 AND 80 THEN
    RAISE EXCEPTION 'INVALID_OBSERVATION';
  END IF;
  IF abs(extract(epoch FROM (now()-v_observed))) > 900 THEN RAISE EXCEPTION 'OBSERVATION_TIME_OUT_OF_RANGE'; END IF;

  SELECT * INTO v_existing FROM public.upi_gateway_observations WHERE bank_reference_number=p_bank_reference_number;
  IF FOUND THEN
    IF v_existing.matched_payment_id IS NULL THEN
      RETURN jsonb_build_object('matched',false,'duplicate',true,'status','DUPLICATE');
    END IF;
    SELECT * INTO v_payment FROM public.upi_gateway_payments WHERE id=v_existing.matched_payment_id;
    RETURN jsonb_build_object('matched',true,'duplicate',true,'status',v_payment.status,
      'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
  END IF;

  INSERT INTO public.upi_gateway_observations(id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at)
    VALUES(coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());

  SELECT count(*)::integer INTO v_candidate_count
  FROM public.upi_gateway_payments p
  WHERE p.merchant_id=v_device.merchant_id
    AND p.status IN ('ACTIVE','EXPIRED')
    AND p.amount_paise=p_amount_paise
    AND p.created_at <= v_observed + interval '30 seconds'
    AND p.expires_at IS NOT NULL
    AND p.expires_at >= v_observed - interval '10 minutes';

  IF v_candidate_count <> 1 THEN
    RETURN jsonb_build_object('matched',false,'duplicate',false,
      'status',CASE WHEN v_candidate_count > 1 THEN 'AMBIGUOUS' ELSE 'UNMATCHED' END,
      'candidateCount',v_candidate_count,
      'message',CASE WHEN v_candidate_count > 1 THEN 'Several donations have the same amount and time window; sent for manual review.' ELSE 'No unique payment matched this notification. No donation was confirmed.' END);
  END IF;

  SELECT * INTO v_payment FROM public.upi_gateway_payments p
  WHERE p.merchant_id=v_device.merchant_id
    AND p.status IN ('ACTIVE','EXPIRED')
    AND p.amount_paise=p_amount_paise
    AND p.created_at <= v_observed + interval '30 seconds'
    AND p.expires_at IS NOT NULL
    AND p.expires_at >= v_observed - interval '10 minutes'
  ORDER BY p.created_at ASC
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED'); END IF;

  UPDATE public.upi_gateway_payments SET status='PROCESSING', bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''), observed_at=v_observed, processing_started_at=now(), updated_at=now()
    WHERE id=v_payment.id;
  UPDATE public.upi_gateway_observations SET status='PROCESSING', matched_payment_id=v_payment.id
    WHERE bank_reference_number=p_bank_reference_number;
  RETURN jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING',
    'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
END;
$$;
REVOKE ALL ON FUNCTION public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) TO service_role;

-- 4) Private screenshot-evidence store. An order ID is a high-entropy capability token;
-- users can upload only against a recent, non-successful donation attempt. Evidence is private.
CREATE TABLE IF NOT EXISTS public.donation_payment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE REFERENCES public.donation_intents(order_id) ON DELETE CASCADE,
  evidence_path text NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','confirmed','rejected')),
  verified_utr text,
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS donation_payment_reviews_status_idx
  ON public.donation_payment_reviews(status, created_at DESC);
ALTER TABLE public.donation_payment_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.donation_payment_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.donation_payment_reviews TO authenticated;
GRANT ALL ON public.donation_payment_reviews TO service_role;
DROP POLICY IF EXISTS donation_payment_reviews_admin_read ON public.donation_payment_reviews;
CREATE POLICY donation_payment_reviews_admin_read ON public.donation_payment_reviews
  FOR SELECT TO authenticated USING (public.is_janwatch_admin());

CREATE OR REPLACE FUNCTION public.can_upload_donation_payment_evidence(p_order_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donation_intents d
    WHERE d.order_id=p_order_id AND d.status <> 'succeeded'
      AND d.created_at > now()-interval '30 days'
  );
$$;
REVOKE ALL ON FUNCTION public.can_upload_donation_payment_evidence(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_upload_donation_payment_evidence(text) TO anon, authenticated, service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('donation-payment-evidence','donation-payment-evidence',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
DROP POLICY IF EXISTS donation_evidence_upload_by_order ON storage.objects;
CREATE POLICY donation_evidence_upload_by_order ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (
    bucket_id='donation-payment-evidence'
    AND array_length(storage.foldername(name),1)=1
    AND public.can_upload_donation_payment_evidence((storage.foldername(name))[1])
  );
DROP POLICY IF EXISTS donation_evidence_admin_read ON storage.objects;
CREATE POLICY donation_evidence_admin_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id='donation-payment-evidence' AND public.is_janwatch_admin());

CREATE OR REPLACE FUNCTION public.janwatch_submit_donation_payment_evidence(
  p_order_id text, p_evidence_path text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, storage AS $$
DECLARE v_donation public.donation_intents%rowtype; v_review public.donation_payment_reviews%rowtype;
BEGIN
  IF p_order_id IS NULL OR char_length(p_order_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'Invalid donation order reference'; END IF;
  IF p_evidence_path IS NULL OR char_length(p_evidence_path)>500 OR split_part(p_evidence_path,'/',1)<>p_order_id THEN RAISE EXCEPTION 'Evidence path does not match this donation reference'; END IF;
  IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Evidence note is too long'; END IF;
  SELECT * INTO v_donation FROM public.donation_intents WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Donation reference not found'; END IF;
  IF v_donation.status='succeeded' THEN RAISE EXCEPTION 'This donation is already verified'; END IF;
  IF v_donation.created_at < now()-interval '30 days' THEN RAISE EXCEPTION 'This donation attempt is too old for online evidence upload'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='donation-payment-evidence' AND o.name=p_evidence_path) THEN RAISE EXCEPTION 'Upload the screenshot before submitting the review request'; END IF;
  INSERT INTO public.donation_payment_reviews(order_id,evidence_path,note,status,submitted_by,created_at,updated_at)
    VALUES(p_order_id,p_evidence_path,nullif(btrim(p_note),''),'pending_review',auth.uid(),now(),now())
  ON CONFLICT(order_id) DO UPDATE SET
    evidence_path=EXCLUDED.evidence_path,note=EXCLUDED.note,status='pending_review',verified_utr=NULL,
    admin_note=NULL,submitted_by=auth.uid(),reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
  WHERE public.donation_payment_reviews.status <> 'confirmed'
  RETURNING * INTO v_review;
  IF NOT FOUND THEN RAISE EXCEPTION 'A confirmed review cannot be replaced'; END IF;
  RETURN jsonb_build_object('submitted',true,'reviewId',v_review.id,'orderId',v_review.order_id,'status',v_review.status);
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_submit_donation_payment_evidence(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.janwatch_submit_donation_payment_evidence(text,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.janwatch_admin_review_donation_payment(
  p_review_id uuid, p_decision text, p_utr text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role text; v_review public.donation_payment_reviews%rowtype; v_donation public.donation_intents%rowtype;
  v_utr text := nullif(btrim(p_utr),'');
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id=auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator permission required'; END IF;
  IF p_decision NOT IN ('confirm','reject') THEN RAISE EXCEPTION 'Decision must be confirm or reject'; END IF;
  IF length(coalesce(p_note,''))>1000 THEN RAISE EXCEPTION 'Review note is too long'; END IF;
  SELECT * INTO v_review FROM public.donation_payment_reviews WHERE id=p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment evidence request not found'; END IF;
  IF v_review.status <> 'pending_review' THEN RAISE EXCEPTION 'This payment evidence request was already reviewed'; END IF;
  SELECT * INTO v_donation FROM public.donation_intents WHERE order_id=v_review.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Donation intent no longer exists'; END IF;

  IF p_decision='confirm' THEN
    IF v_donation.status='succeeded' AND v_donation.utr IS DISTINCT FROM v_utr THEN RAISE EXCEPTION 'This donation is already verified with a different UTR'; END IF;
    IF v_utr IS NULL OR char_length(v_utr) NOT BETWEEN 6 AND 100 THEN RAISE EXCEPTION 'Enter the bank UTR / transaction reference checked against the receiving account statement'; END IF;
    IF EXISTS (SELECT 1 FROM public.donation_intents d WHERE d.utr=v_utr AND d.order_id<>v_review.order_id) THEN RAISE EXCEPTION 'This UTR is already linked to another donation'; END IF;
    IF EXISTS (SELECT 1 FROM public.upi_gateway_payments p WHERE p.bank_reference_number=v_utr AND p.order_id<>v_review.order_id) THEN RAISE EXCEPTION 'This UTR is already linked to another gateway payment'; END IF;
    UPDATE public.donation_intents d
      SET status='succeeded', utr=v_utr, verified_at=now(), updated_at=now(),
          gateway_payment_id=coalesce(d.gateway_payment_id, (SELECT p.id::text FROM public.upi_gateway_payments p WHERE p.order_id=v_review.order_id LIMIT 1))
      WHERE d.order_id=v_review.order_id;
    -- Mark the related gateway session if it exists. This is admin-confirmed, audited state,
    -- not a claim that the browser screenshot itself proves payment.
    UPDATE public.upi_gateway_payments SET status='SUCCESS',bank_reference_number=v_utr,
      completed_at=now(),updated_at=now(),queue_position=0
      WHERE order_id=v_review.order_id AND status <> 'SUCCESS';
    UPDATE public.donation_payment_reviews SET status='confirmed',verified_utr=v_utr,
      admin_note=nullif(btrim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      WHERE id=p_review_id;
    RETURN jsonb_build_object('status','confirmed','message','Donation manually confirmed. Reconcile the UTR against the receiving bank statement.');
  END IF;

  UPDATE public.donation_payment_reviews SET status='rejected',admin_note=nullif(btrim(p_note),''),
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() WHERE id=p_review_id;
  RETURN jsonb_build_object('status','rejected','message','Evidence request rejected; donation remains unverified.');
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_admin_review_donation_payment(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_review_donation_payment(uuid,text,text,text) TO authenticated;

-- Soft-remove from public activity/totals while preserving a private audit record for admins.
CREATE TABLE IF NOT EXISTS public.donation_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  donation_id uuid,
  order_id text,
  action text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.donation_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.donation_admin_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.donation_admin_audit TO authenticated;
GRANT ALL ON public.donation_admin_audit TO service_role;
DROP POLICY IF EXISTS donation_admin_audit_read ON public.donation_admin_audit;
CREATE POLICY donation_admin_audit_read ON public.donation_admin_audit FOR SELECT TO authenticated USING (public.is_janwatch_admin());

CREATE OR REPLACE FUNCTION public.janwatch_admin_set_donation_removed(
  p_donation_id uuid, p_removed boolean, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_role text; v_order_id text;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id=auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator permission required'; END IF;
  IF length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Removal note is too long'; END IF;
  UPDATE public.donation_intents SET admin_hidden=p_removed,updated_at=now()
    WHERE id=p_donation_id RETURNING order_id INTO v_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Donation record not found'; END IF;
  INSERT INTO public.donation_admin_audit(admin_user_id,donation_id,order_id,action,note)
    VALUES(auth.uid(),p_donation_id,v_order_id,CASE WHEN p_removed THEN 'donation_soft_removed' ELSE 'donation_restored' END,nullif(btrim(p_note),''));
  RETURN jsonb_build_object('status','saved','removed',p_removed,'orderId',v_order_id,'note',nullif(btrim(p_note),''));
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_admin_set_donation_removed(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_set_donation_removed(uuid,boolean,text) TO authenticated;

-- Admin-editable timer: regular admins queue changes for super-admin approval; super-admin applies now.
CREATE OR REPLACE FUNCTION public.janwatch_admin_set_payment_session_minutes(p_minutes integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_role text; v_request_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id=auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator permission required'; END IF;
  IF p_minutes NOT BETWEEN 5 AND 30 THEN RAISE EXCEPTION 'Payment timer must be between 5 and 30 minutes'; END IF;
  IF v_role='super_admin' THEN
    UPDATE public.donation_settings SET payment_session_minutes=p_minutes,updated_by=auth.uid(),updated_at=now() WHERE id=true;
    RETURN jsonb_build_object('status','saved','message','Payment session timer updated. New sessions use the new duration.');
  END IF;
  INSERT INTO public.donation_settings_change_requests(requested_by,changes)
    VALUES(auth.uid(),jsonb_build_object('payment_session_minutes',p_minutes)) RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('status','pending_approval','request_id',v_request_id,'message','Timer change submitted for super-admin approval.');
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_admin_set_payment_session_minutes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_set_payment_session_minutes(integer) TO authenticated;

-- Existing super-admin approval function updates general settings. This trigger applies a timer
-- key only when that same request transitions to approved, retaining the existing approval workflow.
CREATE OR REPLACE FUNCTION public.janwatch_apply_payment_timer_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_minutes integer;
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.changes ? 'payment_session_minutes' THEN
    v_minutes := (NEW.changes->>'payment_session_minutes')::integer;
    IF v_minutes NOT BETWEEN 5 AND 30 THEN RAISE EXCEPTION 'Approved payment timer must be between 5 and 30 minutes'; END IF;
    UPDATE public.donation_settings SET payment_session_minutes=v_minutes,updated_by=NEW.reviewed_by,updated_at=now() WHERE id=true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS donation_settings_apply_payment_timer_approval ON public.donation_settings_change_requests;
CREATE TRIGGER donation_settings_apply_payment_timer_approval
  AFTER UPDATE OF status ON public.donation_settings_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.janwatch_apply_payment_timer_approval();

-- 7) Receiving-account settings controlled in the main Admin Console. These are public
-- payment details, not secrets. Normal admins request changes; only super_admin applies them.
CREATE TABLE IF NOT EXISTS public.upi_gateway_receiver_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  receiving_vpa text NOT NULL CHECK (receiving_vpa ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  payee_name text NOT NULL CHECK (char_length(btrim(payee_name)) BETWEEN 1 AND 99),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.upi_gateway_receiver_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upi_gateway_receiver_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.upi_gateway_receiver_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.upi_gateway_receiver_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  receiving_vpa text NOT NULL CHECK (receiving_vpa ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  payee_name text NOT NULL CHECK (char_length(btrim(payee_name)) BETWEEN 1 AND 99),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS upi_gateway_receiver_requests_idx
  ON public.upi_gateway_receiver_change_requests(status, created_at DESC);
ALTER TABLE public.upi_gateway_receiver_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upi_gateway_receiver_change_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.upi_gateway_receiver_change_requests TO service_role;

-- Worker-only lookup. If no approved database row exists, the Worker can bootstrap from its
-- current UPI_VPA / UPI_PAYEE_NAME environment values.
CREATE OR REPLACE FUNCTION public.upi_gateway_get_receiver_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('receivingVpa', receiving_vpa, 'payeeName', payee_name)
     FROM public.upi_gateway_receiver_settings WHERE id = true),
    jsonb_build_object('receivingVpa', NULL, 'payeeName', NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.upi_gateway_get_receiver_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upi_gateway_get_receiver_settings() TO service_role;

CREATE OR REPLACE FUNCTION public.janwatch_admin_get_upi_receiver_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_active jsonb; v_requests jsonb;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator permission required'; END IF;
  SELECT jsonb_build_object('receivingVpa',receiving_vpa,'payeeName',payee_name,'updatedAt',updated_at,'updatedBy',updated_by)
    INTO v_active FROM public.upi_gateway_receiver_settings WHERE id = true;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'requested_by',r.requested_by,'receiving_vpa',r.receiving_vpa,'payee_name',r.payee_name,
    'status',r.status,'review_note',r.review_note,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,'created_at',r.created_at
  ) ORDER BY r.created_at DESC),'[]'::jsonb)
  INTO v_requests FROM (SELECT * FROM public.upi_gateway_receiver_change_requests ORDER BY created_at DESC LIMIT 50) r;
  RETURN jsonb_build_object('active',coalesce(v_active,'{}'::jsonb),'requests',v_requests);
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_admin_get_upi_receiver_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_get_upi_receiver_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.janwatch_admin_set_upi_receiver_settings(p_receiving_vpa text, p_payee_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_vpa text := lower(btrim(coalesce(p_receiving_vpa,''))); v_payee text := btrim(coalesce(p_payee_name,'')); v_request_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator permission required'; END IF;
  IF v_vpa !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN RAISE EXCEPTION 'Enter a valid receiving UPI ID (VPA)'; END IF;
  IF char_length(v_payee) NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Payee name must contain 1–99 characters'; END IF;
  IF v_role = 'super_admin' THEN
    INSERT INTO public.upi_gateway_receiver_settings(id,receiving_vpa,payee_name,updated_by,updated_at)
      VALUES(true,v_vpa,v_payee,auth.uid(),now())
      ON CONFLICT(id) DO UPDATE SET receiving_vpa=excluded.receiving_vpa,payee_name=excluded.payee_name,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    RETURN jsonb_build_object('status','saved','message','Receiving UPI ID and payee name are now active for new checkout sessions. Verify the displayed payee in a UPI app before accepting payments.');
  END IF;
  INSERT INTO public.upi_gateway_receiver_change_requests(requested_by,receiving_vpa,payee_name)
    VALUES(auth.uid(),v_vpa,v_payee) RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('status','pending_approval','request_id',v_request_id,'message','Receiving-account change submitted for super-admin approval. Current checkout details remain active until approval.');
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_admin_set_upi_receiver_settings(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_admin_set_upi_receiver_settings(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.janwatch_super_admin_review_upi_receiver_request(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_req public.upi_gateway_receiver_change_requests%rowtype;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF auth.uid() IS NULL OR coalesce(v_role,'') <> 'super_admin' THEN RAISE EXCEPTION 'Super administrator permission required'; END IF;
  IF length(coalesce(p_note,'')) > 500 THEN RAISE EXCEPTION 'Review note is too long'; END IF;
  SELECT * INTO v_req FROM public.upi_gateway_receiver_change_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiving-account request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'This receiving-account request has already been reviewed'; END IF;
  IF p_approve THEN
    INSERT INTO public.upi_gateway_receiver_settings(id,receiving_vpa,payee_name,updated_by,updated_at)
      VALUES(true,v_req.receiving_vpa,v_req.payee_name,auth.uid(),now())
      ON CONFLICT(id) DO UPDATE SET receiving_vpa=excluded.receiving_vpa,payee_name=excluded.payee_name,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  END IF;
  UPDATE public.upi_gateway_receiver_change_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    review_note=nullif(btrim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_request_id;
  RETURN jsonb_build_object('status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'message',CASE WHEN p_approve THEN 'Receiving-account change approved. Verify the payee in a UPI app before taking live donations.' ELSE 'Receiving-account change rejected; the previous active details remain in use.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.janwatch_super_admin_review_upi_receiver_request(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.janwatch_super_admin_review_upi_receiver_request(uuid,boolean,text) TO authenticated;

-- Keep the public aggregate in sync with admin soft-removal: hidden donations must not
-- inflate the public total or contribution count.
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
  from public.donation_intents where status = 'succeeded' and admin_hidden = false;

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

NOTIFY pgrst, 'reload schema';
