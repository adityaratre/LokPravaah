# LokPravaah UPI reliability patch — apply in this order

## What was identified

The current Worker builds `upi://pay` with `tr=payment.id`, where `payment.id` is a hyphenated UUID of 36 characters. NPCI's published UPI linking guidance gives a 35-character/digit limit for the transaction reference field. This is a concrete QR/intent interoperability defect and may explain why some UPI apps resolve the payee but fail when submitting the payment. It cannot prove the payer's bank/PSP did not also have a temporary issue.

## 1. Back up and apply SQL

1. Take a Supabase backup first.
2. Open Supabase → SQL Editor → New query.
3. Run `database/LokPravaah_UPI_Database_Fix_v2.sql` against the same project already used by LokPravaah.
4. Review the final query results. `old_single_active_index` should be `NULL`.
5. If the database has both legacy and receiver-aware `upi_gateway_create_payment` overloads, also apply `supabase/lokpravaah_upi_payment_overload_compat.sql`. It removes ambiguous defaults from the receiver-aware function and keeps a secure compatibility wrapper for six-argument Workers.

This is an update migration for an existing database. It expects the donation and Cloudflare gateway schema to already exist.

## 2. Apply the Worker code changes

Replace these files in your repository with the matching files from this patch:

- `cloudflare-upi-worker/src/index.js`
- `cloudflare-upi-worker/tests/gateway.test.js`

The Worker change sends a unique 32-character reference (no UUID hyphens) in the UPI `tr` field, shortens the `tn` field, reads the session timer setting from Supabase with an environment-variable fallback, and displays a checkout countdown. SQL must be applied first because the Worker now selects `upi_transaction_ref` from `upi_gateway_payments`.

## 3. Run tests and deploy

From `cloudflare-upi-worker`, run:

```sh
node --check src/index.js
node --test tests/gateway.test.js
```

Then commit/push the changed files and wait for the Cloudflare Worker deployment action to succeed.

## 4. Test safely

Use your own controlled test account and the smallest permitted amount. Confirm:

- UPI app shows the intended payee and exact amount.
- The payment completes successfully in the payer's app/bank.
- Only an authenticated receiving-account notification and accepted signed webhook mark the donation succeeded.
- Two different donors can open payment sessions at the same time. If notifications have the same amount and cannot be uniquely matched, they stay unmatched for manual reconciliation rather than being assigned to the wrong donor.

If the new URI still fails across UPI apps, make a separate direct ₹1 transfer to the same receiving UPI ID from the UPI app (not from the website). If direct transfer also fails, contact the receiving bank/UPI provider with the failure/reference details; SQL cannot override a bank/PSP decline. Do not retry if the bank shows a debit until you reconcile it.

## Important scope note

This SQL migration creates the support-ticket tables, private donation-proof claim table, admin review RPC, and super-admin payment timer/review settings RPC. The React UI must call those RPCs and render the ticket/evidence review screen; database objects alone cannot create UI controls. The Worker patch also does not claim a live bank transaction has been tested.
