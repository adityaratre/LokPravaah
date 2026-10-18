# Admin Console UPI Pairing Fix — Apply Instructions

The standalone gateway `/admin` HTML page is removed. Device pairing is now inside the existing website Admin Console at:

**Admin Console → Platform controls → Donations & UPI → UPI observer pairing**

Only `super_admin` sees the control. The Worker also validates the signed-in Supabase access token and checks `user_roles.role = super_admin` server-side before creating a one-time pairing QR. A direct `/admin` request returns 404.

## Apply to your existing GitHub repository

1. Download and extract this project ZIP, or use `LokPravaah_AdminConsole_UPI_Pairing_Patch.zip` if you only want the changed files.
2. In GitHub Desktop, open your existing `LokPravaah` repository and copy the included files into the matching paths, replacing files when asked. Do not overwrite `.git` or any secret `.env` file.
3. Commit and push to `main`. Cloudflare Pages should rebuild the website; the GitHub Actions workflow should deploy the Worker.
4. Confirm the Pages production build variables are set to:
   - `VITE_DONATION_GATEWAY_PORTAL_URL=https://lokpravaah.online`
   - `VITE_DONATION_GATEWAY_API_URL=https://lokpravaah.online`
   - `VITE_DONATION_MERCHANT_KEY=00000000-0000-0000-0000-000000000001`
5. In Cloudflare, confirm the gateway Worker is named `lokpravaah-upi-gateway` and only has the path-specific routes in `cloudflare-upi-worker/wrangler.jsonc`. Do not bind the Worker as a Custom Domain for the whole `lokpravaah.online` host, because the root website must stay on Pages. The `/admin*` Worker route deliberately returns 404.
6. Keep the Worker secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOKPRAVAAH_DONATION_WEBHOOK_URL`, and `LOKPRAVAAH_DONATION_WEBHOOK_SECRET`; keep the real `UPI_VPA` and `UPI_PAYEE_NAME` variables. The gateway Worker no longer needs `ADMIN_API_TOKEN` for pairing.
7. Run the gateway migration SQL only if it hasn't been applied in this Supabase project. Then sign in with your super-admin account and generate a pairing QR from the existing console.

## Verification notes

The Worker tests in this package pass locally. The website source files parse/transpile, but a full frontend build was not completed in this environment because npm dependency downloads failed with DNS/network errors. The patch has not been deployed to your GitHub/Cloudflare accounts and no real bank transfer was verified.
