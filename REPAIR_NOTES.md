# LokPravaah Repair Build — Report Details, AI Retry and Withdrawals

This build contains source-code repairs, not a live deployment. Keep your existing `.env` values; do not replace them with the placeholders in `.env.example`.

## 1. Apply the database patch

Use the Supabase SQL Editor for the same project referenced by this app. Run `supabase/admin_reports_payout_methods_patch.sql` after the existing V4 platform migration. It updates administrator report visibility and private evidence read access, configures the allowed UPI/bank/gift-card request methods, and installs the secured point-adjustment routine. Re-running this patch is intended to be safe.

## 2. Deploy the AI Edge Function

A function file inside this ZIP does not update the hosted function automatically. In a terminal opened in the project folder:

```bash
npx supabase login
npx supabase link --project-ref zfcvfkchttpisuizndur
npx supabase functions deploy janwatch-ai --project-ref zfcvfkchttpisuizndur
```

In Supabase Dashboard → Edge Functions → Secrets, set `OPENROUTER_API_KEY` to a valid key. Optionally set `OPENROUTER_MODELS` to one or more current model IDs; the function always reserves a final OpenRouter attempt for `openrouter/free`. Keys must stay in Edge Function secrets, never in browser `VITE_` variables. The UI intentionally shows a plain user message when all providers fail; use Edge Functions → `janwatch-ai` → Logs to determine why a live request failed.

After deployment, sign in and run Admin console → Platform controls → Feature switches → Test AI connection. A successful build alone does not prove a provider key is valid or the hosted function is reachable.

## 3. Reports

Open Admin console → Reports. Use **Refresh reports** to retry if loading failed and **View details** to open a report's full description, reporter profile fields available to administrators, coordinates, status timeline and any private evidence that the storage policy permits. If the list remains empty, verify that the signed-in user is `admin` or `super_admin` in `public.user_roles`, and that the SQL patch ran against this project's database.

## 4. Points and withdrawals

In Admin console → Platform controls → Rewards & withdrawals:

- Select **Grant points** or **Deduct points** and enter a reason. Deductions cannot consume points reserved by an active withdrawal.
- Set points-per-rupee, minimum points, automatic report milestone rewards, and which of UPI, bank transfer or gift card are enabled.
- Users can submit only methods enabled by the administrator. Bank-transfer requests collect account holder name, account number and IFSC; gift-card requests collect email or phone for manual delivery.
- Admins can approve/reject requests and record the real external payout reference when marked paid. These controls do not automatically transfer funds or issue gift cards.

## Validation status

- TypeScript/TSX syntax parsing: passed for all source files.
- ZIP integrity and required-feature static checks: run for this archive.
- Full `npm run build`: not verified in this environment because dependencies could not be installed here.
- Live Supabase migrations, deployed Edge Function and provider response: not testable from this workspace; apply the steps above and test on the actual project.
