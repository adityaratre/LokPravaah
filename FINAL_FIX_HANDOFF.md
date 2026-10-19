# LokPravaah repair handoff — 19 October 2026

## Live change verified

The connected Supabase project **JANWATCH** now has the missing `public.janwatch_admin_adjust_reward_points(uuid, integer, text)` RPC. The initial live schema probe showed it was absent while Admin Operations called it, which explains why manual Grant/Deduct Points could fail. The targeted migration `supabase/lokpravaah_admin_reward_adjustment_fix.sql` was applied successfully and rechecked in the live database. PostgREST received its schema-cache reload.

The function checks the signed-in caller's `admin` / `super_admin` role; requires a real target account; limits the adjustment to ±1,000,000 points; requires a 3–400 character reason; serializes against same-user withdrawal requests; blocks deductions below points reserved by pending, approved, or paid withdrawals; writes the immutable ledger entry and records an audit event. Positive grants require the rewards feature and reward programme to be enabled.

## Other live observations

- Supabase Edge Functions `janwatch-ai` and `donation-webhook` are ACTIVE.
- The deployed AI source has OpenRouter's free-router fallback, Gemini backup, optional Groq backup, prompt-language matching (English / Hindi / Hinglish), and provider-failure diagnostics.
- The live database has donation, UPI payment/observation/device, receiver settings, evidence-review and support-ticket tables/functions.
- The older single-active-payment index is absent in the live schema.
- Supabase security advisors report broader existing SECURITY DEFINER execute warnings plus a leaked-password-protection warning; review the individual findings before changing unrelated policies.
- Cloudflare Worker production deployment, Pages deployment and an actual receiving-bank transfer were not performed from this database check.

## Deployment / verification

1. Keep a backup before further schema changes.
2. Apply the incremental reward RPC migration on any other environment, after the V4 platform migration and rewards/gift-card repair. It is safe to re-run.
3. Keep `supabase/lokpravaah_payment_reliability_and_manual_review.sql` after the support/concurrency migration; do not re-run the old gateway baseline afterward because it can restore the obsolete single-active-payment index.
4. Set provider secrets only in Supabase Edge Function Secrets, never in `VITE_*` variables.
5. Run `npm run check:rpc-contract` and `npm run build`; this environment ran the Worker tests (13/13 pass) and the RPC-contract check successfully, but its complete frontend build could not be verified because npm dependencies/types were unavailable.
6. Before enabling public donations, confirm the deployed Worker version, receiver VPA/payee, observer heartbeat, signed webhook, correct bank-statement credit and exactly-once confirmation using a controlled low-value test. Never retry a debit until its bank status is checked.
