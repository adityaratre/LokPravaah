-- This legacy RPC predates the canonical user-owned donation claim flow.
-- It accepts an order ID and a legacy order-folder evidence path, and does not
-- enforce that auth.uid() owns the donation. The current UI uses
-- janwatch_submit_donation_payment_claim instead, so this RPC must not be exposed
-- through PostgREST to anon, authenticated, or service_role clients.
REVOKE ALL ON FUNCTION public.janwatch_submit_donation_payment_evidence(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
