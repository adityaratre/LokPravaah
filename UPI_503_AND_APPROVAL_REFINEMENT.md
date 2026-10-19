# UPI health 503 and approval refinement

See `LokPravaah_UPI_503_Approval_Refinement_Guide.md` in the delivery files for the complete Cloudflare production-secret checklist and testing sequence.

This patch improves `/health` diagnostics without disclosing environment values; adds the known non-secret Supabase and donation-webhook URLs to `wrangler.jsonc`; adds an Admin → Donations & UPI live health button; requires a review note for approve/reject; shows before/proposed values and decision history; and blocks approval of stale requests using a database snapshot.

It does not bundle credentials or claim to update the live Cloudflare/Supabase deployment. Keep real donations disabled until the Worker returns HTTP 200 with `status: UP` and signed end-to-end test payments pass.
