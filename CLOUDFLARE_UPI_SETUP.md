# LokPravaah Cloudflare UPI Gateway Setup

## 1. Deploy code

Merge the supplied project changes into the `main` branch using GitHub Desktop. The website stays on Cloudflare Pages; the gateway Worker name in `cloudflare-upi-worker/wrangler.jsonc` is `lokpravaah-upi-gateway`.

In GitHub repository settings, add the existing Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Run the `Deploy LokPravaah Cloudflare UPI Worker` workflow and make sure both tests and deployment finish successfully.

**Domain rule:** use path-specific Worker routes on `lokpravaah.online`. Do not attach the Worker as a Custom Domain for the whole root hostname. The route `/admin*` is deliberately routed to a handler that returns 404; the website's existing Admin Console is the only place that exposes pairing controls.

## 2. Set Worker secrets and variables

Cloudflare Dashboard → Workers & Pages → `lokpravaah-upi-gateway` → Settings → Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `SUPABASE_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Service-role key from the same Supabase project |
| `LOKPRAVAAH_DONATION_WEBHOOK_URL` | Variable | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook` |
| `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` | Secret | A strong random value; match the Supabase Edge Function secret |
| `UPI_VPA` | Variable | The real receiving UPI ID |
| `UPI_PAYEE_NAME` | Variable | The real receiving account/payee name |
| `LOKPRAVAAH_FRONTEND_ORIGIN` | Variable | `https://lokpravaah.online` |
| `MERCHANT_ID` | Variable | `00000000-0000-0000-0000-000000000001` |
| `PUBLIC_BASE_URL` | Variable | `https://lokpravaah.online` |
| `PAYMENT_SESSION_MINUTES` | Variable | `15` |

There is no `ADMIN_API_TOKEN` requirement. Device-pairing requests use the website's Supabase session; the Worker validates the session with Supabase Auth and authorizes only a server-verified `super_admin` role. Never put the service-role key or webhook secret in browser code.

## 3. Apply Supabase SQL

Use the same Supabase project as the LokPravaah website. If not previously applied, run `supabase/lokpravaah_donations.sql`, then run `supabase/lokpravaah_cloudflare_gateway.sql` in Supabase → SQL Editor. Resolve any SQL error before enabling real payments.

In Supabase → Edge Functions → Secrets, set `DONATION_WEBHOOK_SECRET` to exactly the same value as Cloudflare's `LOKPRAVAAH_DONATION_WEBHOOK_SECRET`. Deploy `supabase/functions/donation-webhook/index.ts`; it must validate the HMAC callback, exact order ID, amount, and currency before a donation can be marked succeeded.

## 4. Configure Cloudflare Pages

Cloudflare Pages → LokPravaah project → Settings → Variables and Secrets. Set these **production build** variables, then trigger a fresh deployment:

- `VITE_DONATION_GATEWAY_PORTAL_URL=https://lokpravaah.online`
- `VITE_DONATION_GATEWAY_API_URL=https://lokpravaah.online`
- `VITE_DONATION_MERCHANT_KEY=00000000-0000-0000-0000-000000000001`

Only the merchant ID is public. Do not expose service-role or webhook secrets.

## 5. Pair the receiving Android phone from the existing website console

1. Sign in to `https://lokpravaah.online` using the super-administrator account.
2. Open **Admin Console → Platform controls → Donations & UPI → UPI observer pairing**.
3. Click **Generate pairing QR**. The Worker validates the live Supabase session and checks the role on the server.
4. Download the Android observer app from the same panel, install it on the phone that receives the bank-credit notifications, and scan the QR. The token expires in 10 minutes and can be used once.
5. Enable the app's required notification/SMS permissions, background activity and battery settings as applicable. Keep the receiving phone online.

The standalone `https://lokpravaah.online/admin` page is intentionally disabled and returns 404. Do not add a public admin token or create a separate gateway admin login.

## 6. Test safely

- `https://lokpravaah.online/health` reports whether the server configuration and Supabase table can be reached. It is not proof of a working payment.
- Run `npm test` in `cloudflare-upi-worker` and check the GitHub Action deployment logs.
- Complete a small controlled payment only after the genuine receiving UPI ID and payee name are configured. Confirm the receiving phone submits a signed notification and the `donation-webhook` validates exact order/amount before public totals change.
- Test wrong signatures, amount mismatches, cancellations, timeouts, and late notifications. Never mark payment successful from a browser callback or screenshot alone.

Local tests do not deploy code to the user's Cloudflare account, run SQL against their live Supabase project, or verify a real bank transaction. Those actions still need to be completed and tested in the respective accounts.
