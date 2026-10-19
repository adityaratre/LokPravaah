# LokPravaah — Payment reliability release guide

## What this release fixes

1. **Payment session creation:** fixes the UPI-reference preflight check so it validates a real UUID-shaped test ID, not the literal `validation`. The generated UPI `tr` reference is numeric and within the common 35-digit limit.
2. **Concurrent checkout:** removes the old `upi_gateway_single_active_slot_uq` index that enforced one ACTIVE/PROCESSING payment per merchant. Each donor now receives an independent payment session. It is safe to open more than one session; a session is not put behind a global queue.
3. **Correct attribution:** a receiving-bank notification is auto-matched only when there is exactly one plausible payment with the matching amount/time window. If multiple donations are plausible (such as two people paying ₹251 around the same time), the system leaves the observation unconfirmed for manual reconciliation instead of assigning a bank credit to the wrong donor.
4. **Webhook / observer diagnostics:** adds a protected super-admin diagnostic endpoint that checks the actual deployed gateway version, required SQL RPC, old unique index, Android observer heartbeat, recent payment states and whether the configured webhook accepts a correctly signed non-mutating diagnostic event.
5. **Timer + receiving account admin controls:** a 5–30 minute per-session timer can be managed from Donations & UPI. The actual receiving UPI ID and payee name can be edited in the main Admin Console; regular admins submit a change request and only the super-admin can activate it. Approved database values override Worker environment fallback values.
6. **Manual payment review:** when an intent exists but the site did not confirm it, the donor can upload a private JPG/PNG/WEBP screenshot (up to 8 MB) against their saved reference. The admin sees the evidence and can confirm or reject it. Confirming requires a UTR reconciled against the receiving account statement; a screenshot by itself is not accepted as proof.
7. **Donation removal:** the admin can hide/restore a donation from public activity and totals while preserving the private record and an audit event.
8. **Refresh session restoration:** restores the signed-in workspace/onboarding route after a browser refresh when the saved Supabase session exists.
9. **Tickets:** includes the user/admin Ticket Support UI and the ticket-category/support migration from the preceding patch.

## Before running anything

- Back up Supabase first.
- Do not accept real donations until the end-to-end signed payment flow is verified.
- Do not put `SUPABASE_SERVICE_ROLE_KEY`, the webhook secret, the pairing signing key, or other private tokens in `VITE_*` variables or frontend source.
- A `UP` response proves the configuration variables and database check pass; it does **not** prove an actual bank transfer, observer notification, valid payee, or signed webhook update succeeded.

## Apply Supabase SQL in the correct order

Use the Supabase project that the live website and Worker actually use. Open **Supabase Dashboard → SQL Editor**.

### Existing production database

1. If ticket support/concurrency migration has **not** previously been applied, run `supabase/lokpravaah_support_and_concurrency_fix.sql` first. It creates the ticket tables and ticket permissions.
2. Then run `supabase/lokpravaah_payment_reliability_and_manual_review.sql` from this release. It removes the stale single-active index and adds manual evidence review, timer settings, receiving-account settings, and corrected matching.

If the ticket migration was already applied, run only `supabase/lokpravaah_payment_reliability_and_manual_review.sql` now.

**Do not re-run `supabase/lokpravaah_cloudflare_gateway.sql` after the reliability migration.** That original migration creates `upi_gateway_single_active_slot_uq` again and restores the old one-at-a-time behavior. If you must rebuild a brand-new database, apply the baseline schema/platform/donation/gateway migrations first, then the support migration, then the reliability migration last.

If any SQL statement errors, stop and resolve that error before deploying the corresponding frontend/Worker changes. Do not ignore SQL errors or turn on donations anyway.

## Deploy code

1. Extract this release ZIP into a local project folder (or copy changed files into the existing repository while preserving unrelated project changes).
2. Commit and push the changed files to the repository's `main` branch.
3. Check GitHub Actions:
   - **Deploy LokPravaah Cloudflare UPI Worker** must run the Worker tests and dry-run, then deploy. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secrets.
   - Cloudflare Pages must build/deploy the website frontend. The frontend build needs a full dependency install. This environment could not finish `npm ci`, so check the actual Cloudflare Pages build log for the complete `tsc -b && vite build` result before proceeding.
   - If deploying the Supabase Edge Function from GitHub Actions, the workflow needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`; confirm that its run succeeded.
4. Verify the active Worker at `https://lokpravaah.online/health` reports `gateway_version: "lokpravaah-upi-payment-reliability-2026-10-19-v2"`. If it still says `lokpravaah-upi-final-2026-10-19`, the changed Worker code is **not** live yet. A green Pages build does not deploy the separate Worker.

## Check hosting / Worker routing

Cloudflare Worker routes should remain path-specific so the main Cloudflare Pages site continues to serve the rest of the domain:

- `lokpravaah.online/health*`
- `lokpravaah.online/api/*`
- `lokpravaah.online/checkout/*`
- `lokpravaah.online/youpi.js`
- `lokpravaah.online/qr.js`
- `lokpravaah.online/qr-lib.js`
- `lokpravaah.online/youpi-sms-gateway.apk`

All routes should belong to the `lokpravaah.online` zone. Do not bind the Worker to the whole root domain and do not expose `/admin*`; the standalone gateway admin remains disabled.

Cloudflare Pages build variables should still point to the active Worker/domain:

- `VITE_DONATION_GATEWAY_PORTAL_URL=https://lokpravaah.online`
- `VITE_DONATION_GATEWAY_API_URL=https://lokpravaah.online`
- `VITE_DONATION_MERCHANT_KEY=00000000-0000-0000-0000-000000000001`

If Supabase stores different URLs or a different merchant ID in **Admin → Donations & UPI**, fix and approve those values too; then rebuild/redeploy Pages as required by your hosting settings.

## Worker environment

Set these in **Cloudflare Worker → Settings → Variables and Secrets**. Use secret fields for private values.

- `SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role key, **Secret**
- `LOKPRAVAAH_DONATION_WEBHOOK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook`
- `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` — **Secret**, same exact value as Supabase `DONATION_WEBHOOK_SECRET`
- `UPI_VPA` — genuine receiving-account UPI ID, bootstrap fallback only
- `UPI_PAYEE_NAME` — exact name displayed by the genuine receiving account, bootstrap fallback only
- `LOKPRAVAAH_FRONTEND_ORIGIN=https://lokpravaah.online`
- `MERCHANT_ID=00000000-0000-0000-0000-000000000001`
- `PUBLIC_BASE_URL=https://lokpravaah.online`
- `PAYMENT_SESSION_MINUTES=15` — bootstrap/default; the database timer controls new sessions after migration

The new approved receiving-account settings in the main Admin Console are stored in Supabase and take precedence over `UPI_VPA`/`UPI_PAYEE_NAME` for new checkout QR/intent data. Keep the environment values correct as a fallback. Check the payee name in a UPI app before taking live donations.

## Supabase webhook

Deploy `supabase/functions/donation-webhook/index.ts` as `donation-webhook` with platform JWT verification disabled; the function verifies `X-Gateway-Signature` using HMAC. In **Supabase → Edge Functions → Secrets**, set:

- `DONATION_WEBHOOK_SECRET` to exactly the same value as Worker `LOKPRAVAAH_DONATION_WEBHOOK_SECRET`.
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available server-side.

Do not expose any of these secrets to the browser or paste them into chat.

## Check the receiving-account observer

In the main site **Admin Console → Platform controls → Donations & UPI → UPI observer pairing**, generate a fresh pairing QR and pair the Android device that receives the actual bank/UPI credit notifications. Grant the app its required notification/SMS access and background permissions, and keep that phone online. Diagnostics must show a recently updated heartbeat. A configured account without a live observer can accept a UPI payment but will not reliably confirm it on the website.

## Verify before any real fundraising

1. Open `https://lokpravaah.online/health`; the version must match the v2 string above. It can return `UP` yet still not be payment-ready.
2. Sign in as super-admin and open **Admin → Donations & UPI → Run payment diagnostics**.
3. Check `databaseDiagnostics.singleActiveIndexPresent` is `false`, `observer.recentlyOnline` is `true`, `webhookSignatureAccepted` is `true`, the receiver is valid, and `readyForAutomaticVerification` is `true`. If any check is false, leave online donations disabled and follow the diagnostic error rather than guessing.
4. Test a tiny amount (e.g. ₹1) from a separate UPI app. Confirm the payee shown inside the UPI app is the correct receiving account. Check that the receiving account actually gets the credit, the Android observer sees its bank notification, the signed webhook completes, the matching donation is marked succeeded exactly once, and the public total changes only once.
5. Test an equal-amount concurrent scenario using controlled test payments. If the observer cannot distinguish two plausible payments, the system must not credit either donor automatically; use UTR/bank statement reconciliation through manual review.
6. Test an unsuccessful/unconfirmed path by uploading screenshot evidence for a pending attempt. Confirm the screenshot is private, appears in the admin review queue, and the record remains unverified until an admin reconciles the actual bank UTR. Test reject, then test hide/restore on an already verified test donation.
7. Verify a browser refresh preserves the authenticated workspace. A session may still be routed to onboarding if the user's `janwatch_onboarding_complete` metadata is false; that is different from a sign-out.

## How to tell what kind of payment failure occurred

- **UPI app says transaction failed before a debit:** verify the receiving VPA and displayed payee/account, and check whether the bank/UPI service itself rejected the transfer. A website health endpoint cannot verify a bank account's ability to receive UPI.
- **Money was debited / bank shows success, but site remains processing/pending:** check the live Worker version, observer heartbeat/parsed credit notification, `upi_gateway_prepare_observation`, webhook signature diagnostic and Edge Function logs. Do not pay again until bank status is checked.
- **`Could not start UPI checkout` appears before the QR/session:** inspect the browser Network request to `POST /api/v1/payments`, response status and `diagnosticCode`. The fixed Worker returns a specific server-side reason; the old version may still reject session creation.
- **More than one same-amount session matches one bank notification:** it must remain unconfirmed for manual reconciliation. The system intentionally avoids potentially confirming the wrong donor.

## Verification status in this handoff

- Cloudflare Worker: `node --check` passed; 13/13 Worker automated tests passed.
- Changed TSX files: syntax transpilation reported zero syntax diagnostics.
- Full frontend build: **not confirmed in this environment**, because `npm ci` could not finish installing dependencies. Confirm the full Cloudflare Pages build succeeds before enabling payments.
- Supabase SQL was prepared and statically reviewed but **not run against your live Supabase database from this chat**. Run it using the migration order above, review SQL results, then execute live payment diagnostics. This release has not been deployed to your production account by this handoff.
