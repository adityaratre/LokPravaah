# LokPravaah Donations — Integration & Launch Guide

## Where is the page?

The donation page is part of the main React application. Visitors can open **Donate** from the top navigation or **Support the project** on the home hero. `/#donate` also works on static hosting. `/donate` is recognized by the app when the host is configured with an SPA fallback to `index.html`.

It includes a custom rupee amount (₹1–₹1,00,000), suggested amounts, anonymous mode, separate opt-ins for the donor leaderboard and public message, a verified total, goal progress, top supporters, recent activity and transparent-use notes. Public activity refreshes every 30 seconds. Unverified/pending records never increase public totals.

## 1. Apply the Supabase migration

Open the SQL Editor for the **same Supabase project used by the site** and run `supabase/lokpravaah_donations.sql` once. It is designed to be re-runnable and ends by asking PostgREST to reload its schema cache.

For a brand-new database, apply the baseline migrations first, in this order:

1. `supabase/schema.sql`
2. `supabase/v4_platform_migration.sql`
3. `supabase/lokpravaah_ai_giftcard_repair.sql`
4. `supabase/lokpravaah_final_worker_blog_patch.sql`
5. `supabase/lokpravaah_donations.sql`

For an existing live website, **do not rerun all baseline migrations just to add donations**. Run the donation migration. If the Blog & Updates `public.site_posts` error or worker/referral updates were never fixed, run `supabase/lokpravaah_final_worker_blog_patch.sql` as well (it is designed to be re-runnable).

## 2. Deploy the signed webhook

Deploy `supabase/functions/donation-webhook/index.ts` as the `donation-webhook` Supabase Edge Function with JWT verification disabled; webhook requests authenticate using the gateway's HMAC signature. The repository workflow `.github/workflows/deploy-supabase-functions.yml` deploys both the AI function and donation webhook when the relevant files change, provided the repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` are configured.

In Supabase → Edge Functions → Secrets, set:

- `DONATION_WEBHOOK_SECRET`: the same strong secret configured on the gateway merchant's webhook settings.
- `SUPABASE_URL`: your project URL (normally already available in Edge Functions).
- `SUPABASE_SERVICE_ROLE_KEY`: the project service-role key, server-side only.

Never put the service-role key or webhook secret in the Vite app or a `VITE_` variable.

## 3. Run the UPI service

The website is a Vite/React frontend; its static hosting cannot run the Node payment API. The UPI gateway is included under `services/lokpravaah-upi/` and needs its own Node.js 20+ process on a VPS/container/Node host. It can be branded under the same domain family (for example, `pay.example.com` and `pay-api.example.com`) while still being a separate backend service.

1. Copy `services/lokpravaah-upi/.env.example` to `services/lokpravaah-upi/.env` and replace **every** placeholder before starting it. Do not commit `.env`.
2. Set `CLOUDFLARE_DOMAIN` to your actual root domain and `LOKPRAVAAH_FRONTEND_ORIGIN` to the exact public site origin (scheme + hostname only, e.g. `https://your-site.example`; no path). The checkout iframe explicitly allows only this configured origin. Without it the browser will block the embedded checkout.
3. Set a random `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` before first database initialization, or choose a strong secret in Merchant Admin. Use the exact same value as `DONATION_WEBHOOK_SECRET` in Supabase.
4. Set `LOKPRAVAAH_DONATION_WEBHOOK_URL` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/donation-webhook` before first initialization, and set the merchant's webhook URL to that same URL. On an already initialized gateway database, verify/update the merchant webhook from the gateway Merchant Admin.
5. Install dependencies and run `npm run dev` for local development. For production, configure domains, TLS/Cloudflare routes, secure credentials, and the UPI receiving account first, then run `npm start`.

The example gateway hosts are derived from your domain: checkout `https://pay.<domain>`, API `https://pay-api.<domain>`, and the privileged Merchant Admin `https://pay-admin.<domain>`. Use the actual returned/configured URLs in the next step.

## 4. Configure the real receiving account and site

In the gateway's separate privileged Merchant Admin:

- Replace the seeded placeholder UPI VPA `merchant@upi` with your real receiving VPA and verify the payee name.
- Confirm the default merchant ID (`00000000-0000-0000-0000-000000000001`) or use the merchant ID shown in the gateway admin. This is a **public merchant identifier**, not a private credential.
- Set the webhook URL and HMAC signing secret; keep the same secret in Supabase Edge Function secrets.
- Configure production HTTPS routes and verify the gateway `/health` endpoints before testing.

In LokPravaah's app **Admin → Donations & UPI**:

- Set the checkout portal URL, payment API URL, and public merchant ID/key.
- Configure campaign text, thank-you copy, goal, suggested amounts, leaderboard, total/progress, recent activity and public message display.
- Ordinary admins can save presentation settings. Changes to donation/payment enablement, gateway URLs/identifier, amount limits, goal and suggested amounts are queued; **only a super administrator can approve or reject them**.
- Admins can review recent donation records and hide/restore verified entries from public activity. Donor emails, UTR and payment IDs are never returned by the public data function.

## 5. Test before launch

Use a controlled test amount and confirm each case:

1. Valid UPI payment: intent begins pending; public total and leaderboard change only after the signed webhook verifies matching order, amount, and INR currency.
2. Failed, cancelled and expired checkout: records do not increase public totals.
3. Wrong webhook secret or changed body: webhook returns an authorization error and the donation remains unverified.
4. Amount mismatch/order not found: webhook rejects the event.
5. Normal admin changes to payment-critical settings remain pending until a super admin decides.
6. Donation opt-in works: donor leaderboard identity and message are not public unless individually opted in; anonymous mode strips donor name/email.
7. The frontend and gateway domains are HTTPS, browser console shows no CORS/frame errors, and there are no placeholder UPI details.

Do not announce fundraising as live until the receiving VPA is real and the end-to-end webhook test succeeds. A success toast from the browser is not proof of payment.
