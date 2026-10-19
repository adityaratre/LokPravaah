# LokPravaah UPI and admin repair — deployment checklist

## Confirmed app / backend issue

The Admin Operations manual points form called `janwatch_admin_adjust_reward_points`, but the SQL files on the repository's main branch did not define it. The targeted repair now defines the RPC with server-side role checks, reserved-withdrawal protection, reward ledger insertion and audit logging. It has been applied to the connected JANWATCH Supabase database and verified present.

A prior UPI Worker patch also shortens the `tr` reference to a numeric value no longer than 35 digits and encodes spaces as `%20`; the live bank/PSP still has to be tested before real donations are enabled.

## Correct Supabase project

The connected Supabase project URL is:

`https://zfcvfkchttpisuizndur.supabase.co`

Confirm Cloudflare Worker `SUPABASE_URL`, `LOKPRAVAAH_DONATION_WEBHOOK_URL`, Pages build URL and publishable key all belong to this same project before changing secrets.

## Supabase migration order for an existing app

1. Take a backup and confirm the Supabase project.
2. Ensure V4 foundation and worker/blog patch are already applied.
3. If gift-card repair has already been applied, run `supabase/lokpravaah_admin_reward_adjustment_fix.sql`. Otherwise run the updated `supabase/lokpravaah_ai_giftcard_repair.sql`, which includes this RPC.
4. Ensure `supabase/lokpravaah_support_and_concurrency_fix.sql` is applied; then apply `supabase/lokpravaah_payment_reliability_and_manual_review.sql`.
5. Do not rerun the old `lokpravaah_cloudflare_gateway.sql` baseline after the reliability migration; it can recreate the obsolete single-active-payment index.

## Worker variables and secrets

Set these in Cloudflare Workers & Pages → `lokpravaah-upi-gateway` → Production:

- `SUPABASE_URL=https://zfcvfkchttpisuizndur.supabase.co`
- `LOKPRAVAAH_DONATION_WEBHOOK_URL=https://zfcvfkchttpisuizndur.supabase.co/functions/v1/donation-webhook`
- `UPI_VPA`: the real receiver UPI ID from the receiving account app
- `UPI_PAYEE_NAME`: the exact beneficiary name shown by the UPI app
- `LOKPRAVAAH_FRONTEND_ORIGIN=https://lokpravaah.online`
- `PUBLIC_BASE_URL=https://lokpravaah.online`
- `PAYMENT_SESSION_MINUTES=15` (approved database admin settings can override this for new sessions)

Keep `SUPABASE_SERVICE_ROLE_KEY`, `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` and admin tokens as server-side secrets. Cloudflare `LOKPRAVAAH_DONATION_WEBHOOK_SECRET` must exactly match Supabase Edge Function secret `DONATION_WEBHOOK_SECRET`.

For AI, use Supabase Edge Function Secrets such as `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, optional `GROQ_API_KEY`, `OPENROUTER_MODELS`, `GEMINI_MODEL`, `AI_ENABLE_GEMINI_BACKUP` and `AI_ENABLE_GROQ_BACKUP`. The live `janwatch-ai` function is ACTIVE and has fallback logic already deployed.

## Final end-to-end checks

- Admin → Platform controls → Donations & UPI: check receiver/payee, session timer, super-admin approval, diagnostics and manual UTR/evidence review.
- Admin → Platform controls → Rewards & withdrawals: test points adjustment using a non-sensitive test account and verify ledger/audit record; ensure points already reserved for withdrawals cannot be deducted.
- Confirm worker version matches the repository commit and the observer heartbeat is recent.
- Make one controlled small payment from a different UPI app, confirm real receiving-account credit and UTR, signed webhook update, and exactly-once status change. Check a second UPI app. Do not make donors retry if money was debited; inspect the bank statement first.
