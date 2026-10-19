# LokPravaah UPI Cross-App Compatibility Fix v2

## What was found

The Cloudflare Worker was putting the payment session UUID directly into the UPI `tr` field. A conventional UUID includes hyphens and is 36 characters long, while the NPCI merchant reference guidance limits `tr` to 35 digits. The checkout also placed an unnecessarily long order identifier into `tn`. Different UPI apps parse merchant intent links differently, so this can surface as a generic “technical issue / transaction failed” screen even if the QR opens.

The Worker and the shared Node gateway helper now:

- use a numeric UPI transaction reference capped at 35 digits;
- derive a stable reference from the payment UUID when the order ID is non-numeric or too long (never truncate a transaction ID);
- keep `cu=INR`, decimal amount, and encoded payee fields;
- keep the transaction note short and use `%20` for spaces;
- preserve per-donor active sessions instead of serializing every donor behind one merchant-wide slot;
- avoid automatically attaching a bank alert to one of multiple same-amount active sessions. Ambiguous alerts remain unmatched rather than confirming the wrong donation;
- remove the Worker `/admin*` route so it does not intercept the main website admin path; preserve dashboard variables on Worker deploys.

## Files

- `cloudflare-upi-worker/src/index.js` — Cloudflare UPI URI and checkout flow.
- `cloudflare-upi-worker/tests/gateway.test.js` — regression tests for references, session creation, and signed events.
- `cloudflare-upi-worker/wrangler.jsonc` — route/config corrections.
- `services/lokpravaah-upi/packages/common/src/upi.js` and `upi.ts`, plus `apps/payment-api/src/routes/checkout.routes.js` — shared Node gateway URI compatibility.
- `supabase/lokpravaah_cloudflare_gateway.sql` — base schema/function definitions for a new install.
- `supabase/lokpravaah_support_and_concurrency_fix.sql` — existing-database migration, including concurrency correction and ticket-support schema.

## Applying to your existing website

1. Back up your Supabase database first.
2. In your local LokPravaah repository, copy the files from the **full project ZIP** over the existing project, or use the focused **patch ZIP** to replace the exact same relative paths.
3. In GitHub Desktop, inspect the changed files, commit, and push to `main`. Wait for the Cloudflare Worker workflow to finish successfully.
4. In Supabase SQL Editor, run `supabase/lokpravaah_support_and_concurrency_fix.sql` (also supplied separately as a standalone `.sql` file) against the same project already used by LokPravaah. This migration assumes the earlier donation and Cloudflare gateway tables already exist. Do not run the base gateway SQL as a replacement for the migration on an existing production database.
5. To avoid `syntax error at end of input, LINE 0`, open the downloaded `.sql` in Notepad or VS Code, press Ctrl+A then Ctrl+C, create a **New query** in Supabase SQL Editor, paste the whole file, and confirm the editor is not blank before pressing Run. Running an empty editor gives the `LINE 0` error.
6. Confirm Worker production variables are still set. `UPI_VPA` must be the actual receiving UPI ID and `UPI_PAYEE_NAME` must be the registered receiver name. Do not use example values. Keep service-role keys and webhook secrets as secrets, never `VITE_` variables.

## Tests performed on this package

- Cloudflare Worker test suite: **14 passed, 0 failed**.
- Node syntax checks for the changed JavaScript files: passed.
- Shared UPI URI helper smoke test: passed; amount/currency and numeric `tr` validated.
- The complete Vite/React build could not be verified in this environment because dependency installation/type-definition packages were incomplete. This ZIP therefore does **not** claim a verified full-site build.
- The SQL migration was not executed against your live Supabase project from here; run it once with the steps above and share the full SQL error if it reports one.

## Required end-to-end payment test

A `/health` status of `UP` only proves configuration and database reachability; it cannot prove that a PSP/bank accepts a payment to the receiving VPA.

1. After deployment and migration, open the Donate page and create one small controlled test donation.
2. Scan the **newly generated** QR with a UPI app other than PhonePe. Check the app shows the intended receiving name and exact amount before entering the PIN.
3. Complete one ₹1 test payment and verify the receiving bank account actually credits it, then confirm the signed observer/webhook updates the same order to `succeeded`.
4. If a different UPI app still displays “technical issue,” open its **View details** page and record the response/decline code. Also test the same receiving VPA by entering it directly in that app. This differentiates malformed URI from a receiving-account/PSP/bank-side rejection.
5. Do not use an on-screen success/failure message, screenshot, or QR scan as proof of a debit/credit. If money is debited but the site stays pending, do not pay again; keep the UTR and create a support ticket for manual review.

The code fixes the confirmed URI and queue defects. It cannot guarantee acceptance by every issuer/bank or verify the actual account without the live end-to-end test.
