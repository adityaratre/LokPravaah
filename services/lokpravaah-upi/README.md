# LokPravaah UPI Gateway

This is the Node.js payment service used by LokPravaah's Donation page. It provides the checkout portal, payment API, merchant configuration and optional payment-notification observers. It is separate from the Vite/React website process, but can be branded and routed under the same LokPravaah domain.

## Important deployment requirements

- Requires Node.js 20 or later.
- Copy `.env.example` to `.env` and replace every `CHANGE_ME`, `example.com` and `YOUR_PROJECT_REF` placeholder. Never commit `.env`.
- The static Vite website cannot run this Node service by itself. Host this service on a Node server/VPS/container or route a suitable gateway host through Cloudflare Tunnel/reverse proxy.
- Configure a real receiving UPI VPA, public domain and merchant details in the gateway's Merchant Admin panel before enabling contributions. The seeded VPA is a placeholder and cannot receive real donations.
- Configure the merchant webhook URL to your Supabase Edge Function `/functions/v1/donation-webhook`, and set the same strong webhook secret in the gateway merchant settings and Supabase secret `DONATION_WEBHOOK_SECRET`.
- Configure the Supabase project URL and service-role key only as Edge Function secrets; never add the service-role key to Vite variables or browser code.
- A payment is counted by the website only after its signed server webhook validates the order and amount. A checkout callback alone is not proof of payment.

## Start

```sh
cp .env.example .env
npm install
npm run dev
```

For production, configure the Cloudflare domain, secrets, webhook and merchant account first, then run `npm start`. The gateway's merchant/admin console is a separate privileged application from LokPravaah's site admin. Limit it to trusted administrators.

## Connected website settings

In LokPravaah's Admin → **Donations & UPI**, set the HTTPS checkout portal URL, payment API URL, and public merchant key. The UPI VPA, merchant webhook URL/secret and payment-notification integrations remain in the gateway administration console and server environment, not the public website form. Major public donation/payment settings submitted by an admin enter the super-admin approval queue.

## Scope cleanup

The sample storefront, its showcase UI, demo media and store-specific service registration were removed from this bundle. The core gateway packages and optional notification-observer source are retained because they support checkout/payment verification. Source package/API identifiers remain compatible with the supplied SDK.


## Render deployment

For the single-ingress Render configuration, follow [`RENDER_DEPLOYMENT.md`](./RENDER_DEPLOYMENT.md). The existing local/Cloudflare tunnel workflow remains available outside Render.
