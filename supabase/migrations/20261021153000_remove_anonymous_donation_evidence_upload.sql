-- Donor evidence must be uploaded by the authenticated owner under their own user-id path.
-- The legacy order-folder policy allowed unauthenticated uploads that cannot be attached
-- to a valid claim under the current owner/path validation trigger.
DROP POLICY IF EXISTS donation_evidence_upload_by_order ON storage.objects;
