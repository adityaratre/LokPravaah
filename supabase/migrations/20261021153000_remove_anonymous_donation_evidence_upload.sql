-- Donor evidence must be uploaded by the authenticated owner under their own user-id path.
-- The legacy order-folder policy allowed unauthenticated uploads that cannot be attached
-- to a valid claim under the current owner/path validation trigger.
DROP POLICY IF EXISTS donation_evidence_upload_by_order ON storage.objects;

-- The helper was only used by the removed policy; remove the anonymous order-existence oracle too.
DROP FUNCTION IF EXISTS public.can_upload_donation_payment_evidence(text);

-- Donation creation in the current UI requires sign-in. Prevent unauthenticated
-- clients from flooding the pending-intent table and require each intent to belong
-- to the authenticated donor (including donors who choose to appear anonymously).
DROP POLICY IF EXISTS "donation create pending intent" ON public.donation_intents;
REVOKE INSERT ON public.donation_intents FROM anon;
CREATE POLICY "donation create pending intent"
  ON public.donation_intents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND gateway_payment_id IS NULL
    AND utr IS NULL
    AND verified_at IS NULL
    AND admin_hidden = false
    AND currency = 'INR'
    AND amount_paise >= 100
    AND amount_paise <= 10000000
    AND donor_user_id = auth.uid()
    AND (donor_name IS NULL OR char_length(btrim(donor_name)) <= 80)
    AND (donor_email IS NULL OR char_length(btrim(donor_email)) <= 254)
    AND (message IS NULL OR char_length(message) <= 300)
    AND (NOT is_anonymous OR (donor_name IS NULL AND donor_email IS NULL))
    AND (NOT show_message_publicly OR (NOT is_anonymous AND show_on_leaderboard))
  );
