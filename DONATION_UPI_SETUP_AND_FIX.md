# LokPravaah donations — connection and launch checklist

## What was fixed in this package

- The website now has a safe public fallback to the known gateway URL `https://lokpravaah-upi.onrender.com` and the gateway's default public merchant ID. These are public values, not secrets.
- The public `/donate` page now receives the signed-in user's ID/name when a signed-in session is active, and the workspace already has its own **Donate** sidebar item.
- The UI explicitly explains when checkout is connected but payment acceptance is paused.
- Added `supabase/lokpravaah_donation_gateway_config.sql`. It connects the site to the Render gateway but deliberately leaves payments disabled until the real receiving account and webhook have been configured.

## 1. Apply SQL in Supabase

1. Open Supabase Dashboard for the exact project used by `lokpravaah.online`.
2. Go to **SQL Editor → New query**.
3. If the donation migration has not been run yet, run `supabase/lokpravaah_donations.sql` first (after the existing platform migrations).
4. Run the entire `supabase/lokpravaah_donation_gateway_config.sql` file.
5. Refresh `https://lokpravaah.online/donate`. It should no longer say that the gateway URL is missing. It will say payments are paused until the receiving UPI account/webhook is ready.

Do not rerun all baseline migrations on an existing live database just for this configuration.

## 2. Cloudflare Pages build variables

Open **Cloudflare Dashboard → Workers & Pages → your LokPravaah Pages project → Settings → Variables and Secrets**. Add these to the **Build** environment for Production, then trigger a new deployment:

- `VITE_DONATION_GATEWAY_PORTAL_URL` = `https://lokpravaah-upi.onrender.com`
- `VITE_DONATION_GATEWAY_API_URL` = `https://lokpravaah-upi.onrender.com`
- `VITE_DONATION_MERCHANT_KEY` = `00000000-0000-0000-0000-000000000001`

These three are public settings. Never put `SUPABASE_SERVICE_ROLE_KEY`, the webhook secret, `ADMIN_API_TOKEN`, bank credentials, or other private keys in any `VITE_` variable.

## 3. Configure the receiving UPI account (not a QR upload)

Open `https://lokpravaah-upi.onrender.com/admin` and authenticate using the `ADMIN_API_TOKEN` from the Render service's **Environment** settings. In the Merchant/Receiving account settings:

- Replace the demo placeholder `merchant@upi` with the real UPI ID (VPA) that belongs to the person/entity receiving LokPravaah contributions.
- Use the UPI ID from the actual receiving account's UPI app/bank app. Confirm the displayed payee name is correct by checking it in the UPI app before approving any test transfer.
- Do **not** use `merchant@upi`; it is a demo placeholder.
- This integration is designed to create a checkout/UPI intent. Do not paste a random QR image into the site. The checkout should generate payment details from the configured receiving VPA. Only use a static QR if the gateway's documented receiving-account flow explicitly requires one.

The merchant ID above is an identifier, not the receiving UPI ID. It does not tell you where money will be deposited.

## 4. Configure the signed Supabase webhook

1. Find the project ref in the site's `VITE_SUPABASE_URL` (the subdomain before `.supabase.co`).
2. The webhook URL is `https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook`.
3. Deploy `supabase/functions/donation-webhook/index.ts` as `donation-webhook` with JWT verification disabled; it authenticates requests using the gateway HMAC signature.
4. In **Supabase → Edge Functions → Secrets**, set `DONATION_WEBHOOK_SECRET` to exactly the same value as `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` in Render. Keep it private. Also confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available to the function; service-role key is server-side only.
5. In the gateway Merchant Admin, set the webhook URL to the same endpoint and ensure signed callbacks use `X-Gateway-Signature: sha256=<hex HMAC-SHA256 of the exact raw request body>`.
6. If GitHub Actions deploys Supabase functions, its repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` must be configured; otherwise deploy through your normal Supabase CLI workflow.

## 5. Render environment / persistence

Render service settings remain:

- Root Directory: `services/lokpravaah-upi`
- Build: `npm install`
- Start: `npm start`
- Health path: `/health`

Confirm `LOKPRAVAAH_FRONTEND_ORIGIN=https://lokpravaah.online`, `LOKPRAVAAH_DONATION_WEBHOOK_URL` points to the Supabase endpoint, and unique `ADMIN_API_TOKEN`, `INTERNAL_SERVICE_TOKEN`, `OBSERVER_API_TOKEN`, `ENCRYPTION_MASTER_KEY` (64 hex characters), and `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` are configured. Keep encryption key stable while encrypted values exist. Do not paste secrets into chat or commit them to GitHub.

**Important:** Render Free storage is ephemeral and this gateway uses SQLite. Do not accept real donations on Render Free: the payment service's database may be lost on restart/redeploy. Use persistent storage on a compatible plan or implement and test a persistent database adapter before fundraising.

## 6. Enable payments only after verification

Test in a controlled way:

- `https://lokpravaah-upi.onrender.com/health` reports `UP`.
- `/youpi.js` loads over HTTPS and the browser console shows no CORS/frame errors.
- A small test payment uses the correct receiving payee.
- Supabase `donation_intents` starts as `pending` and only becomes `succeeded` after a valid signed webhook matching order ID and exact amount.
- Invalid signature, cancelled payment, failed payment, expired payment, or amount mismatch must not increase public totals.
- Restart/redeploy persistence is verified before enabling real money.

Only after all checks pass, enable the payment setting in **Admin → Donations & UPI** (and have the super administrator approve the change), or run this one statement in Supabase SQL Editor:

```sql
update public.donation_settings
set payment_gateway_enabled = true, updated_at = now()
where id = true;
```

If any test is not verified, leave payments disabled. A checkout success message alone is not proof that money was received.
