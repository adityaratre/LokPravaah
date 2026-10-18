# LokPravaah Cloudflare UPI Gateway — Setup Guide

## What this build does

This adds a Cloudflare Worker replacement for the **LokPravaah donation checkout path**. It keeps the existing donation SDK endpoint contract (`/youpi.js`, `POST /api/v1/payments`, `/checkout/:id`, and payment status polling), stores gateway state in the same Supabase PostgreSQL project, and confirms success only after a signed notification from the receiving-account Android observer matches the exact amount and active payment session.

This is **not a complete line-by-line port of every YouPI PG service**. Legacy self-hosted Gmail/Chrome automation, WhatsApp, queue dashboards and unrelated payment features are not all migrated. This is a focused donation gateway, not an acquiring bank or regulated payment aggregator. A UPI QR is not proof of payment.

## A. Add the code to GitHub

1. Download/extract the patch ZIP and copy the included files into the root of your existing `LokPravaah` Git repository, keeping `.git` untouched.
2. Commit and push to `main` using GitHub Desktop.
3. The included GitHub Action tests and deploys the Worker when `cloudflare-upi-worker/**` changes.

## B. Set up Cloudflare Worker deployment (no card-dependent VPS)

1. In Cloudflare Dashboard, open **My Profile → API Tokens → Create Token**. Create a token with only the permissions required to edit Workers and deploy Workers Scripts for your account; keep it secret.
2. Find your Cloudflare **Account ID** in the account overview.
3. In GitHub repository settings, open **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. In Cloudflare, open **Workers & Pages** and confirm Workers on your account are available. Push the Worker files to `main` or use Actions → `Deploy LokPravaah Cloudflare UPI Worker` → Run workflow. Open the GitHub Actions run and confirm its tests and deploy step pass.
5. Open the new Worker settings → **Domains & Routes** and add the custom domain `pay.lokpravaah.online`. The `lokpravaah.online` zone must already be active in Cloudflare DNS. If you use the generated `*.workers.dev` URL instead, update `PUBLIC_BASE_URL` below and the website environment variables to that exact URL.

## C. Apply SQL in Supabase

Use the **same Supabase project as LokPravaah**.

1. If the donation migration has not already been applied, run `supabase/lokpravaah_donations.sql` first. Do not rerun unrelated baseline migrations on an existing live database.
2. Run the entire file `supabase/lokpravaah_cloudflare_gateway.sql` in Supabase → SQL Editor. It creates private gateway tables and RPC functions, enabling only the server-side service role to access them.
3. Confirm `public.donation_intents` and the `upi_gateway_*` tables exist. If SQL errors occur, stop and fix them before enabling checkout.

## D. Configure Cloudflare Worker secrets and variables

In the Worker → Settings → Variables and Secrets, add these settings. Add items marked **Secret** using the secret type, not plain text where possible.

| Name | Type | Value |
|---|---|---|
| `SUPABASE_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Service-role key from this Supabase project; never expose it to the browser |
| `LOKPRAVAAH_DONATION_WEBHOOK_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook` |
| `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` | Secret | A new random secret, used identically in Supabase Edge Function Secrets |
| `ADMIN_API_TOKEN` | Secret | A separate strong random token for the private `/admin` console |
| `UPI_VPA` | Variable | Your genuine receiving UPI ID, e.g. `name@bank` (example only; replace it) |
| `UPI_PAYEE_NAME` | Variable | Actual payee/account name that should display in the UPI app |
| `LOKPRAVAAH_FRONTEND_ORIGIN` | Variable | `https://lokpravaah.online` |
| `MERCHANT_ID` | Variable | `00000000-0000-0000-0000-000000000001` |
| `PUBLIC_BASE_URL` | Variable | `https://pay.lokpravaah.online` |
| `PAYMENT_SESSION_MINUTES` | Variable | `15` |

Do not use `merchant@upi`, a fake UPI ID, or a sample payee name in production. Do not put any secret in a `VITE_` variable or in Git. Use independent random values and do not reuse secrets that may have been committed or exposed previously.

## E. Configure the Supabase donation webhook

In Supabase → Edge Functions → Secrets:

- Set `DONATION_WEBHOOK_SECRET` to the **exact same value** as Worker `LOKPRAVAAH_DONATION_WEBHOOK_SECRET`.
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured for the Edge Function.
- Deploy `supabase/functions/donation-webhook/index.ts` as `donation-webhook` with JWT verification disabled; the function authenticates callbacks by HMAC signature.

The Worker sends the signed event only after the receiving-account observer submits a notification with a valid device signature. The webhook checks the exact donation order ID, amount and currency before marking a row succeeded.

## F. Configure Cloudflare Pages (main site)

In Cloudflare Pages → LokPravaah project → Settings → Variables and Secrets, set these **production build variables**, then run a fresh deployment:

- `VITE_DONATION_GATEWAY_PORTAL_URL=https://pay.lokpravaah.online`
- `VITE_DONATION_GATEWAY_API_URL=https://pay.lokpravaah.online`
- `VITE_DONATION_MERCHANT_KEY=00000000-0000-0000-0000-000000000001`

The merchant identifier is public and may be in browser config. The service-role key, `ADMIN_API_TOKEN` and webhook secret must never be public.

## G. Pair the receiving-account Android phone

1. Open `https://pay.lokpravaah.online/admin`.
2. Enter the private Worker `ADMIN_API_TOKEN` and generate the one-time pairing QR.
3. Download/install the included `youpi-sms-gateway.apk` (or use the matching Android observer app you have from the source), then scan the QR in that app.
4. On the receiving-account phone, enable notification access (and SMS permission only if your chosen mode needs it), allow background activity, and exclude the app from battery optimisation where Android allows it.
5. The Android phone must receive the genuine credit notification for the configured UPI receiving account. If the phone is offline, notification permission is disabled, or the bank app/SMS does not include an amount and unique transaction reference, auto-verification may not occur.

## H. Test before collecting donations

1. Open `https://pay.lokpravaah.online/health`. It should return `status: UP` and all checks true. This only tests configuration and database reachability; it does not prove UPI works.
2. Use the smallest practical amount and confirm checkout shows the exact expected receiving name and amount.
3. Complete a real controlled payment only after the correct receiving UPI ID is configured. Confirm the receiver's Android notification is forwarded with a valid signature and unique bank reference.
4. Confirm the Edge Function logs show a successful signed webhook, `donation_intents.status` becomes `succeeded`, and only then public totals update.
5. Test wrong signature, amount mismatch, cancellation, timeout, queue and late notifications. If status does not match the bank record, do not ask the payer to pay again until reconciled.

## Free-plan notes and limitations

- Cloudflare Workers Free has request/day and CPU limits; this code generates QR images in the browser to avoid doing heavy QR work inside the Worker.
- Supabase Free has a 500 MB database quota and can pause a project after inactivity. The free plan includes no automatic database backups. Keep a backup/export and periodically verify the project remains active.
- Free hosting is useful for a prototype/small-volume pilot, but it is not a payment availability guarantee. Do not advertise dependable real-money donations until end-to-end tests, backups, monitoring and applicable Indian legal/tax/payment rules have been reviewed.
- This direct-to-UPI observer design is not equivalent to a bank/regulated payment aggregator and does not offer settlement guarantees. If the source notification lacks a unique reference or the receiver phone misses the event, keep the donation unconfirmed and reconcile it manually.

## Local smoke tests

Inside `cloudflare-upi-worker`, run:

```bash
npm install
npm test
npm run check
```

This source was checked with Node.js syntax checks and its local route tests. The Worker has **not** been deployed in the user's Cloudflare account, the SQL has **not** been run against the live Supabase project, and no real end-to-end bank payment was performed by preparing this patch.
