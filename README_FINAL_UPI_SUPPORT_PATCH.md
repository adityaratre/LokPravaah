# LokPravaah — final UPI reliability + donation support patch

This is a source patch for the LokPravaah repository. It is **not deployed to your live site automatically**. Apply the SQL and push/deploy the source files below before expecting the live health version to change.

## What changed

- UPI intent uses a short, safe transaction reference (`tr` <= 35 chars) instead of putting a 36-character UUID in `tr`; the note is kept short and URL encoded. NPCI’s published UPI merchant-link guidance specifies a transaction reference of up to 35 characters ([NPCI circular PDF](https://www.npci.org.in/PDF/npci/upi/circular/2017/Circular18_BankCompliances_to_enbaleUPIMerchantecosystem_0.pdf)). This is a credible code-level compatibility defect, but cannot prove the receiving bank/PSP will accept a real transfer.
- Gateway health includes an explicit build fingerprint. The patched Worker version should be `lokpravaah-upi-final-2026-10-19-upi-uri-compat-2-admin-settings`.
- Worker reads approved receiving VPA/payee name, timer, minimum/maximum donation and enable/disable status from `donation_settings` on the server. It fails closed if settings are unavailable and rejects payments when admin has paused online donations or the amount is outside configured limits.
- Independent concurrent payment sessions: removes the old merchant-wide unique active-payment slot. Same-amount overlapping observer notifications are left unmatched for manual review instead of assigning a payment to the wrong donor.
- Adds a server-side checkout countdown configured from 5 to 30 minutes in Admin → Donations & UPI.
- Adds private user receipt submission after a failed/expired/unconfirmed checkout; admin manual verification queue requires a UTR checked against the receiving-bank statement. Screenshots do not automatically verify a donation.
- Adds remove/restore from public totals (soft removal + audit; original financial record is retained), support ticket tab wiring, auth persistence, refresh recovery for the latest donation review and late signed webhook recovery.

## 1) Backup and apply SQL

Before running SQL, use Supabase Dashboard → Database → Backups (or take a fresh export you can restore).

The `lokpravaah_final_payment_support_fix.sql` migration depends on the existing LokPravaah donation and gateway schema. The prerequisite migrations are:

1. `supabase/lokpravaah_donations.sql`
2. `supabase/lokpravaah_cloudflare_gateway.sql`
3. `supabase/lokpravaah_support_and_concurrency_fix.sql`

If these tables/functions already exist and the earlier migrations have been run, **do not rerun the whole baseline schema**. Run only `LokPravaah_Final_UPI_Donation_Support_Migration.sql` from this bundle in Supabase SQL Editor. The final migration is designed to be re-runnable for its DDL/function replacements, but check the complete result for errors. If it errors, stop and share the exact SQL error; do not enable donations.

## 2) Replace source files

Extract `LokPravaah_Final_UPI_Donation_Support_Fix.zip` into the root of a fresh clone/working copy of the `LokPravaah` repository, preserving folders. Allow it to replace only the listed paths. Review the diff in GitHub Desktop.

Commit and push to `main`. Cloudflare Pages should deploy the website; the Worker should deploy from `cloudflare-upi-worker/` through your configured GitHub Action or with Wrangler in that directory.

The bundle includes a standalone SQL file also copied to `supabase/lokpravaah_final_payment_support_fix.sql`. The standalone migration download is identical.

## 3) Check the live Worker version

After migration and Worker deploy, open:

- `https://lokpravaah.online/health`
- If needed, the Worker dev URL `/health` to isolate root-domain route issues.

The root `/health` response must show:

- `status: "UP"`
- `gateway_version: "lokpravaah-upi-final-2026-10-19-upi-uri-compat-2-admin-settings"`
- `checks.settings: true`, `checks.database: true`, `checks.receivingVpa: true`, `checks.upiIntentFormat: true`.

If the `gateway_version` remains `lokpravaah-upi-final-2026-10-19` or another older value, the live request is still reaching the old Worker; the patch is not yet active. If `settings: false`, apply the final migration to the same Supabase project used by the Worker and confirm the `donation_settings` row exists. Health cannot verify that the recipient bank will accept the transfer.

## 4) Configure recipient and timer in Admin

Open the main website’s protected Admin Operations → Donations & UPI panel.

- Enter the exact receiving UPI ID/VPA and payee name shown by the receiving account's own UPI app. Save both together.
- Set the payment session timer (5–30 minutes; default 15).
- Normal admins’ payment-critical changes go to the super-admin approval queue. A super admin must approve them. After approval, the Worker reads them from the database. If both receiver fields are blank, the Worker uses its server-side environment fallback; ensure it is the actual receiving VPA, never a placeholder such as `merchant@upi`.
- Toggle online payments off if any payment test is failing. The Worker enforces this setting server-side, not just in the UI.

Do not put service-role keys, webhook secrets or admin tokens in a `VITE_` variable or commit them to Git.

## 5) How manual payment review works

1. Donor must be signed into LokPravaah to submit private evidence.
2. When checkout fails, expires or cannot confirm, the donation page offers a receipt upload (JPG, PNG, WEBP or PDF up to 10 MB), optional UTR, time and note. Latest attempt is restored after refresh.
3. Admin Operations → Donations & UPI → Manual payment verification shows the claim and opens its private screenshot with a temporary signed link.
4. Admin confirms only after matching the exact amount and UTR/reference in the receiving-bank statement. Enter the actual bank UTR and an admin note; otherwise reject the claim with a reason. A screenshot or sender-app screen is not enough by itself.
5. Confirmed donations enter public totals. Admin can remove/restore a verified record from public sums/leaderboard/recent activity without deleting the financial record.
6. User ticket support is in the workspace’s Support tickets view; staff have a separate Admin Operations → Ticket Support tab. It supports ticket categories/subcategories, conversation and status/priority workflow, including donation/UPI issues.

## 6) Required payment test before going live

Do not repeatedly retry real payments. First use a controlled ₹1 test:

1. In the receiving account's own UPI app, verify the VPA and payee name. Independently initiate a ₹1 transfer by manually entering the exact VPA (not the LokPravaah QR). Confirm actual credit in the receiving bank statement. If the direct transfer itself fails, the issue is likely account/VPA/issuer bank/UPI-provider side—not the QR code. Contact the bank/UPI app or onboard through an authorized payment aggregator.
2. After the Worker version changes, start one new website donation. Confirm the UPI app shows the exact payee and ₹1.00. If it fails, record the UPI app, exact on-screen error/response code (View Details), timestamp and whether any debit occurred; do not paste UPI PIN/OTP or secret keys.
3. If direct VPA works but QR/intent still fails, inspect the generated URI fields: `pa` (real VPA), `pn` (exact payee), `am=1.00`, `cu=INR`, `tr` <= 35 chars, and short `tn`. App/bank-specific policies can still reject an otherwise formatted intent.
4. When a bank notification is observed, only a signed gateway webhook with matching order, amount and INR currency makes the public donation successful. Same-amount overlapping notifications are deliberately held for manual review rather than risk crediting the wrong donor.
5. Check successful, failed, cancelled, expired, duplicate webhook and manual-review cases. Only re-enable public donations once the receiving bank statement and website record agree.

## Verification performed for this bundle

- Cloudflare Worker JavaScript syntax check: passed.
- Worker unit tests: 17/17 passed, covering health/configuration, short UPI transaction reference, amount limits, payment-off setting, admin receiver settings, admin route protection and signed notification flow.
- TypeScript/TSX syntax transpilation for the modified frontend/function files: passed.
- Full `npm run build` could not be verified in this environment because `npm ci` did not finish and the partial `node_modules` tree lacks TypeScript definition packages (`react`, `node`, `d3-*`, etc.). Run a clean `npm ci` and `npm run build` in GitHub Actions/your local repo before enabling donations. SQL was not executed against your live database from here.
