# LokPravaah Cloudflare UPI gateway (donation-focused)

This is a Worker-native replacement for the LokPravaah donation checkout API. It is **not** a line-by-line port of every YouPI PG service. The old repository has separate Node servers, local SQLite state, Gmail/Chrome automation and administration tools; those are not portable to a single stateless Worker without further service-specific redesign.

This compatibility gateway implements the endpoints used by LokPravaah's donation SDK:

- `GET /health`
- `GET /youpi.js`
- `POST /api/v1/payments`
- `GET /api/v1/payments/:id`
- `POST /api/v1/payments/:id/cancel`
- `GET /checkout/:id` and `/checkout/:id/qr.svg`
- signed Android observer enrollment, heartbeat and notification endpoints
- a token-protected `/admin` page that generates one-time Android observer pairing QR codes

Payment intent data, queue state, observation records and paired-device credentials live in Supabase PostgreSQL. Private gateway tables deny browser roles access. The Worker alone uses the service-role key. The existing Supabase `donation-webhook` function remains the authority that changes a `donation_intents` row to `succeeded`, after it verifies the HMAC signature and exact order/amount match.

## Important limitation

A UPI URI or QR code only asks a UPI app to pay. It does **not** prove money was received. This setup confirms a donation only after an authenticated Android observer forwards a supported receiving-bank credit notification that has a matching amount, unique bank reference, active payment slot, and valid timestamp. Keep a receiving-account Android phone connected with notification/SMS permissions. If no verified event arrives, the payment remains unconfirmed and must be reconciled; never manually make a browser callback mark it successful.

The slot queue permits one active payment for the receiver at a time because generic bank SMS alerts often omit the checkout order ID. This reduces same-amount attribution collisions but is not equivalent to an acquiring bank or regulated payment aggregator. Validate Indian payment, tax, and fundraising requirements before collecting public contributions.

## Deploy from Cloudflare Dashboard (no card-dependent VPS needed)

1. Push this project folder to the private or public GitHub repository you control. Do not commit `.dev.vars`, `.env`, Supabase service-role keys, webhook secrets, admin tokens or any `data/.secrets/` directory.
2. Add the GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (see `CLOUDFLARE_UPI_SETUP.md`). The included `.github/workflows/deploy-cloudflare-upi-worker.yml` installs Wrangler, runs tests, and deploys from this directory after pushes to `main`.
3. After the first deployment, open Worker **Settings → Domains & Routes** and add the custom domain `pay.lokpravaah.online` (the domain must be active on Cloudflare DNS). If you use `workers.dev` instead, put that exact URL in the website variables and `PUBLIC_BASE_URL`.
4. In Worker **Settings → Variables and Secrets**, set:

   | Name | Kind | Value |
   |---|---|---|
   | `SUPABASE_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret | The service-role key from the same Supabase project |
   | `LOKPRAVAAH_DONATION_WEBHOOK_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook` |
   | `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` | Secret | A new random secret; must exactly match Supabase `DONATION_WEBHOOK_SECRET` |
   | `ADMIN_API_TOKEN` | Secret | A separate long random token for `/admin` |
   | `UPI_VPA` | Variable | Your **real** receiving UPI ID, for example `name@bank` (replace; do not use a sample) |
   | `UPI_PAYEE_NAME` | Variable | The real payee/account name shown to UPI users |
   | `LOKPRAVAAH_FRONTEND_ORIGIN` | Variable | `https://lokpravaah.online` |
   | `MERCHANT_ID` | Variable | `00000000-0000-0000-0000-000000000001` |
   | `PUBLIC_BASE_URL` | Variable | `https://pay.lokpravaah.online` |
   | `PAYMENT_SESSION_MINUTES` | Variable | `15` |

   Never use a Supabase anon key in place of the service-role key for these server-side functions. Never expose service-role/webhook/admin secrets in a `VITE_` variable or browser code. Generate independent random secrets; do not reuse prior secrets that were posted into chat or accidentally committed.

5. In the **same Supabase project as LokPravaah**, run SQL Editor migration files in this order:
   - Existing live project: if not already applied, run `supabase/lokpravaah_donations.sql` first. Do **not** rerun unrelated baseline migrations just to add the gateway.
   - Run `supabase/lokpravaah_cloudflare_gateway.sql`.
6. In Supabase → Edge Functions → Secrets, set `DONATION_WEBHOOK_SECRET` to the **exact same** value as Cloudflare Worker `LOKPRAVAAH_DONATION_WEBHOOK_SECRET`. Keep `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured for the Edge Function as well. Deploy `supabase/functions/donation-webhook/index.ts` with JWT verification disabled because the function uses HMAC verification.
7. In Cloudflare Pages → the LokPravaah project → Settings → Variables and Secrets, set these **production build variables** and trigger a fresh build:
   - `VITE_DONATION_GATEWAY_PORTAL_URL=https://pay.lokpravaah.online`
   - `VITE_DONATION_GATEWAY_API_URL=https://pay.lokpravaah.online`
   - `VITE_DONATION_MERCHANT_KEY=00000000-0000-0000-0000-000000000001`
8. Test `https://pay.lokpravaah.online/health`. It should report `status: UP` with Supabase, receiver VPA, webhook, admin and database checks true. The health check is a configuration smoke test, not proof of a successful payment.
9. Open `https://pay.lokpravaah.online/admin`, enter `ADMIN_API_TOKEN`, generate a pairing QR, and scan it in the Android Observer app on the phone that receives the bank credit notifications. Complete Android permission and battery optimisation steps. A test bank alert must reach `/api/v1/pollers/android/events` or `/api/v1/observers/sms` with valid HMAC headers.
10. Start with a very small test amount. Confirm: (a) the payment is stored as pending/active, (b) a real bank credit notification is received, (c) a unique bank reference matches the active amount, (d) the signed `donation-webhook` returns a 2xx, and (e) only then the donation total increases. Also test cancellation, expiry, queue behaviour, wrong signatures and amount mismatch. Do not use a customer screenshot or checkout-page callback as proof of payment.

## Local test

The source contains Node.js integration smoke tests for basic route behavior and QR generation; they can run without credentials:

```bash
node --test tests/gateway.test.js
```

For actual Cloudflare bundling/deploy, install Wrangler in this directory and run:

```bash
npm install
npm run check
npm run deploy
```

Local unit tests do not replace a Supabase migration run, actual Cloudflare deployment, Android observer pairing or end-to-end bank test.
