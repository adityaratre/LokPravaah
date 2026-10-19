# LokPravaah UPI 503 + approval workflow fix

## What the current 503 means

`/health` is reaching `lokpravaah-cloudflare-upi-gateway`, but the Worker cannot confirm its server-side configuration. The previous response's `supabase:false`, `admin:false`, and `database:false` indicate the Supabase URL/service-role credentials are not available to that live Worker or cannot access the REST API. `receivingVpa:false` in that older response may be a side effect of the failed database check; it is not enough on its own to conclude the receiving UPI ID is wrong.

The updated Worker health endpoint returns safe diagnostic **names and HTTP status codes only**—it never returns secret values. The updated Worker config sets the non-secret Supabase URL and donation-webhook URL and preserves dashboard variables through deploy. Private secrets still must be configured in Cloudflare.

## Deploy these files

Extract `LokPravaah_UPI_Health_Approval_Refinement_Patch.zip` over a backup/copy of the repository, preserving the folder paths. It contains the changed Worker health code/config/tests, the improved Donations & UPI admin UI, and the updated Supabase migration.

Commit and push to `main`. The Worker deployment workflow runs tests and deploys `lokpravaah-upi-gateway` when files under `cloudflare-upi-worker/` change. Wait for the Cloudflare GitHub Action to finish.

## Set production Worker secrets

Cloudflare Dashboard → Workers & Pages → `lokpravaah-upi-gateway` → Settings → Variables and Secrets → **Production**:

**Secrets (never put these in Git or Vite variables):**

- `SUPABASE_SERVICE_ROLE_KEY` — use the server-side legacy `service_role` key for the Supabase project used by LokPravaah. Do not use the public anon key.
- `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` — use a strong random secret. It must exactly match `DONATION_WEBHOOK_SECRET` under Supabase → Edge Functions → Secrets.

**Receiving account:**

- Enter the real account's `UPI_VPA` and `UPI_PAYEE_NAME` as Worker variables **or** set both in the website's Admin Console → Donations & UPI settings and approve the change as super admin. Do not use sample/demo values.
- Check that the Worker has `SUPABASE_URL` and `LOKPRAVAAH_DONATION_WEBHOOK_URL`. The updated `wrangler.jsonc` declares these non-secret values for the project's existing Supabase endpoint. If your project was moved, update them to the actual project URL/function URL.
- `MERCHANT_ID` must match the public merchant ID saved in Donations & UPI. The config defaults to `00000000-0000-0000-0000-000000000001`.
- Keep `LOKPRAVAAH_FRONTEND_ORIGIN=https://lokpravaah.online`, `PUBLIC_BASE_URL=https://lokpravaah.online`, and `PAYMENT_SESSION_MINUTES=15` unless you intentionally reconfigure those values.

Check these settings in the **Production** environment, not Preview only. Do not paste any key into chat.

## Verify health

Open `https://lokpravaah.online/health` after deployment. Expected result is HTTP 200 with `status: "UP"` and all checks true. If it remains 503, look at the returned `diagnostics.missing`, `databaseError`, and `settingsError` values. The diagnostics name what's missing without revealing actual secrets. Also test the workers.dev URL for the same Worker if needed.

The updated Admin Console → Platform Controls → Donations & UPI has **Test gateway now**. It tests the current API base URL and displays checks and diagnostics when the Worker supports the updated health response.

## Approval workflow improvements

The updated UI shows current/base values next to the proposed values, makes a 5-character minimum review note mandatory for approval or rejection, and displays decision history. The SQL migration adds a base-settings snapshot. Before applying a request, the database compares affected settings with the saved snapshot and blocks a stale request rather than silently overwriting changes made since submission. Refresh settings and submit a new request if a request is reported stale.

Run `LokPravaah_UPI_Tickets_Complete_Fix.sql` in the same Supabase project's SQL Editor after a backup. This incremental migration assumes `supabase/lokpravaah_donations.sql` and `supabase/lokpravaah_cloudflare_gateway.sql` already ran. It is designed to be rerunnable; if SQL Editor reports an error, stop and review the full error instead of applying fragments randomly.

## Before enabling real donations

A health check only verifies configuration and database reachability. Keep payments disabled until you confirm the receiving name/VPA inside the UPI app, perform a controlled end-to-end test, observe the receiving bank credit, and confirm that a valid signed callback changes the exact donation/order. Do not mark a payment verified from a screenshot alone. If a donor has been debited but the site has not confirmed it, ask them not to retry until the bank status is checked.
