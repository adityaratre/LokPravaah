# Render deployment — LokPravaah UPI Gateway

This deployment mode preserves the local/Cloudflare startup and adds Render's single public HTTP ingress. `npm start` automatically selects Render mode when `RENDER=true` or `RENDER_SERVICE_ID` is present.

## Render service settings

- **Runtime:** Node
- **Root Directory:** `services/lokpravaah-upi`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Node:** 22.13 or newer (the gateway uses Node's built-in `node:sqlite`)
- **Health Check Path:** `/health`

On Render, the service listens on `0.0.0.0:$PORT`. The payment API, checkout portal, merchant admin, and control center remain on loopback-only ports. Public requests are routed through the Render ingress: `/api/*` to the payment API, `/checkout/*` and SDK/static paths to checkout, `/admin` to merchant admin, and `/gmail/*` to the optional Gmail observer.

## Environment variables

Render provides `RENDER_EXTERNAL_URL` and `PORT` for a web service. The gateway uses `RENDER_EXTERNAL_URL` as the default public base URL. Add the following variables in **Render → Environment** and replace every example with a new, unique secret value. You can generate 32-byte hex secrets in a local terminal with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; run it separately for each secret, and keep the encryption key stable:

- `ADMIN_API_TOKEN` — long random token used to access the Merchant Admin panel and its protected operations.
- `INTERNAL_SERVICE_TOKEN` — long random secret shared by co-located internal services.
- `OBSERVER_API_TOKEN` — long random token for observer ingestion.
- `ENCRYPTION_MASTER_KEY` — 64 hexadecimal characters (32 random bytes); keep this stable as long as encrypted database values exist.
- `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` — long random webhook secret; configure the *same* secret in the Supabase Edge Function secret `DONATION_WEBHOOK_SECRET` and in the merchant webhook settings.
- `LOKPRAVAAH_FRONTEND_ORIGIN` — `https://lokpravaah.online` (use the real canonical origin for your deployed site).
- `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are not required by this version of the token-based Merchant Admin console.
- `LOKPRAVAAH_DONATION_WEBHOOK_URL` — your Supabase Edge Function URL ending in `/functions/v1/donation-webhook`.

Optional `BASE_CHECKOUT_URL`, `BASE_PAYMENT_API_URL`, `BASE_ADMIN_URL`, and `BASE_GMAIL_URL` may be set to custom URLs. If the services share the Render host, use path-based URLs: the checkout and API base can both be the Render URL, `BASE_ADMIN_URL` can be `<Render URL>/admin`, and `BASE_GMAIL_URL` can be `<Render URL>/gmail`. If later adding distinct custom hostnames to the same Render service, set the matching `BASE_*_URL` values and configure those custom domains in Render.

Gmail and SMS/Android observation services are not auto-started on Render unless explicitly enabled with `ENABLE_GMAIL_OBSERVER=true` or `ENABLE_SMS_OBSERVER=true`. Enable them only after their credentials and callback/observer URLs are configured.

## Storage and real-money warning

This code currently uses SQLite (`node:sqlite`). `DATABASE_URL` in the example file does not make this code use PostgreSQL. Render Free has an ephemeral filesystem and does **not** provide a persistent disk, so data can disappear on deploy/restart. Use this service only for smoke tests on Free. Before accepting real donations, attach a persistent Render disk to the gateway's `data` directory on a compatible paid plan and verify backup/restore, or implement and test a real persistent database adapter. Do not accept real payments while the receiving VPA, merchant settings, webhook signature, admin token, and payment verification are still placeholders.

## Smoke tests after deploy

1. Open `https://<your-render-service>.onrender.com/health`. Expected JSON has `status: "UP"` and `paymentApi`, `checkoutPortal`, `merchantAdmin` all `true`.
2. Open `/` and verify the service landing JSON.
3. Open `/admin` and enter the `ADMIN_API_TOKEN` when prompted.
4. Create a test payment only after a real merchant receiving VPA is configured. Verify the signed Supabase webhook in the Edge Function logs; a checkout redirect or a customer screenshot is not proof of payment.
