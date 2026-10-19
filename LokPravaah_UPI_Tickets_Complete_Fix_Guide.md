# LokPravaah — UPI checkout, concurrency, timer, manual review and support tickets

This package contains the updated website source, Cloudflare Worker source, worker tests and one incremental Supabase migration.

## What this patch changes

- Removes the stale one-active-payment-per-merchant uniqueness rule that can reject later checkout creation.
- Creates new payment sessions independently. Each checkout uses the receiving UPI ID and payee name captured for that session, plus its own server expiry.
- Shows a real countdown in the hosted checkout based on `expires_at`; the protected Donations & UPI settings include a 5–30 minute session timer.
- Uses the stored Admin Console merchant ID setting for the Worker/API and validates it against the database configuration.
- If two open donations have the same amount and a bank alert cannot uniquely identify one order, leaves the notification unmatched for manual review instead of risking confirmation on the wrong donor.
- Adds private support-ticket category/subcategory management, user ticket creation, secure screenshot/PDF evidence upload, replies, ticket status/priority/resolution notes, and admin Ticket Support access.
- Adds admin manual donation verification by real bank UTR/reference and required review note. Verification is role-checked and recorded in a private review log plus the audit log.
- Prioritizes unverified records in the Donations & UPI admin record list and returns up to 500 recent rows.
- Returns clearer diagnostics when the gateway cannot load its payment settings or create a session.

## Apply the SQL migration first

1. Open Supabase Dashboard → SQL Editor for the same project used by LokPravaah.
2. Take a database backup first.
3. This migration is incremental and assumes the site's donation and Cloudflare gateway base tables already exist. It should be run **after** `supabase/lokpravaah_donations.sql` and `supabase/lokpravaah_cloudflare_gateway.sql` have already been applied. It bundles the ticket-support and concurrency repair, so you do not need to separately run the earlier `lokpravaah_support_and_concurrency_fix.sql` for these changes.
4. Open `supabase/lokpravaah_upi_tickets_complete_fix.sql` from the package, copy all SQL into the SQL Editor, and run it once. It is designed to be rerunnable for these additions/definitions.
5. If Supabase returns an error, stop there and keep donations disabled. Save the full error text; do not keep rerunning selected fragments blindly.

## Apply the source files

1. Extract `LokPravaah_UPI_Tickets_Complete_Patch.zip` over a copy of your existing repository, preserving the included folder paths. It contains only relevant patched files, not credentials or `.env` files.
2. Review the changed files in GitHub Desktop before committing. Commit and push only after reviewing the diff.
3. After push, wait for the Cloudflare Pages frontend build to finish. This runtime could syntax-parse the changed TypeScript/TSX files, but a full frontend type/build run was not available because npm dependency installation timed out in the working environment; verify the actual Pages build before considering the release finished.
4. The Cloudflare Worker workflow should deploy the updated Worker source if its existing GitHub Actions secrets are configured. `wrangler.jsonc` retains path-scoped routes for `/health*`, `/api/*`, `/checkout/*`, `/youpi.js`, `/qr.js`, `/qr-lib.js`, and the observer APK. It deliberately does **not** add a root-wide route or a standalone `/admin` route.

## Confirm the production settings in the protected Admin Console

Open the main site's Admin Console → Platform Controls → Donations & UPI.

- Checkout portal URL: `https://lokpravaah.online`
- Payment API URL: `https://lokpravaah.online`
- Public merchant ID/key: must match the value stored in the setting and be the same identifier configured for the Worker. The default in the Worker config is `00000000-0000-0000-0000-000000000001`; use that default unless you intentionally configure another matching ID.
- Receiving UPI ID and payee/account name: set both together and verify the receiver shown by the UPI app is exactly the account that should receive donations. Do not use demo values.
- UPI checkout timer: choose 5–30 minutes. The saved/approved value controls server session expiry; the countdown reads the session's server expiry rather than a decorative frontend-only timer.
- Check `Donations enabled` and `Payment gateway enabled` only for testing after configuration. Payment-critical changes submitted by an ordinary admin remain queued for a super-admin approval; a super-admin change applies immediately.
- Use the existing Feature switches tab for the platform-wide feature flags. The Ticket Support tab in Platform Controls owns support categories and the ticket inbox.

Cloudflare Worker environment variables/secrets remain necessary for the Worker to reach Supabase and send signed webhooks. Keep `SUPABASE_SERVICE_ROLE_KEY`, webhook secret, admin token and any device-signing credentials as server-only secrets; never place them in `VITE_` variables or commit them.

## Where to find the new controls

- **User side:** signed-in workspace → Support tickets. Users select category → subcategory, explain the problem, optionally enter donation order/UTR/amount/date, upload private evidence, and continue the conversation.
- **Admin side:** Admin Console → Platform Controls → Ticket Support. Admins can open tickets, reply, set status/priority/resolution note, and add/disable category/subcategory pairs.
- **Manual UPI review:** Admin Console → Platform Controls → Donations & UPI → Latest donations & manual verification. Use “Needs review” or “All records”, find the order, then enter a real UTR/reference and a note documenting the bank-account check before pressing Verify receipt.
- **Do not mark a payment successful from a screenshot alone.** Confirm the credit in the receiving bank/UPI account and check the amount/order before manually verifying. The screenshot is evidence to investigate, not payment proof.

## Payment test sequence before accepting donations

1. Open `https://lokpravaah.online/health`; the Worker should return JSON with `status: "UP"`.
2. From two controlled test browsers/devices, create separate small test donation attempts at the same time. Both should get independent payment sessions/QRs and their own countdown, without waiting for the other to finish.
3. Confirm the payee and amount in both UPI apps before paying. Never ask donors to pay to test a production configuration without consent.
4. Verify successful payments only after a signed receiving-account observation/webhook confirms the correct order, amount and UTR. Test a failed/cancelled session and an expired session too.
5. If simultaneous payments have the same amount and the bank notification does not contain a unique order reference, the observer deliberately leaves it unmatched to avoid crediting the wrong donation. Review it using the bank account statement and the manual admin flow.
6. Create a “Paid but website not confirmed” support ticket, attach a test screenshot/PDF, then verify admin can see and answer the ticket and access the private evidence. Resolve it after review.
7. If a payment was debited but the site is pending/failed, tell the user not to pay again until the bank status is checked.

## Verification status

- Cloudflare Worker syntax check: passed.
- Cloudflare Worker tests: 12/12 passed in this environment.
- TypeScript/TSX syntax parse: passed for 13 source files.
- Full frontend `npm run build` and live Supabase SQL execution: **not verified here**. The local build attempt could not run because dependency installation/type packages were unavailable, and this package has not been deployed to your live Cloudflare/Supabase accounts. Do not treat `/health` being `UP` as proof that actual real-money payments are working.
