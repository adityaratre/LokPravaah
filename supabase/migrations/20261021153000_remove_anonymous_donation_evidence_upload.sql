-- Donor evidence must be uploaded by the authenticated owner under their own user-id path.
-- The legacy order-folder policy allowed unauthenticated uploads that cannot be attached
-- to a valid claim under the current owner/path validation trigger.
DROP POLICY IF EXISTS donation_evidence_upload_by_order ON storage.objects;

-- The helper was only used by the removed policy; remove the anonymous order-existence oracle too.
DROP FUNCTION IF EXISTS public.can_upload_donation_payment_evidence(text);
