# LokPravaah AI + Gift Card Repair — Setup Checklist

This patch updates the frontend, Supabase Edge Function, and SQL migration. The AI provider keys are server-side secrets; never put them in `VITE_*`, React code, GitHub commits, or a public `.env` file.

## 1. Apply the database migration once

1. Open the Supabase project used by the live LokPravaah website.
2. Open **SQL Editor** and create a new query.
3. Copy the complete contents of `supabase/lokpravaah_ai_giftcard_repair.sql` into it.
4. Run it and confirm the result shows the `reward_settings` row and the gift card brands (Amazon, Google Play, Croma, PVR).

The migration is safe to re-run. It adds global minimum/maximum withdrawal points, per-brand limits, and secure in-app gift-code delivery. Gift card codes are visible to the request owner and authorised admins only under the existing withdrawal-row RLS policy. No email or SMS is sent.

## 2. Configure AI provider keys in Supabase (required for live answers)

Open **Supabase → Edge Functions → Secrets** and add at least one valid provider key:

- `OPENROUTER_API_KEY` — recommended primary provider key; the function tries the free router first.
- `GEMINI_API_KEY` — optional backup key; the default model is `gemini-2.5-flash`.
- `GROQ_API_KEY` — optional additional backup key.

Optional settings:

- `GEMINI_MODEL` — leave unset to use `gemini-2.5-flash`; if an old model value is present, the function retries the default model.
- `AI_ENABLE_GEMINI_BACKUP=true`
- `AI_ENABLE_GROQ_BACKUP=true`
- `LOKPRAVAAH_AI_ENABLED=true`

Do not add AI provider keys to Cloudflare Pages build variables. The browser must never receive them. If no provider key exists or the provider account has no quota/access, the code will now return a clearer diagnostic instead of pretending a response was generated.

## 3. Deploy the Edge Function

The repository includes `.github/workflows/deploy-supabase-functions.yml`. In GitHub repository **Settings → Secrets and variables → Actions**, create:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID` (the Supabase project reference, not the project URL)

Commit the project files to the repository's `main` or `master` branch, then open **Actions → Deploy Janwatch AI Edge Function** and confirm it succeeds. You can also deploy from the workflow's **Run workflow** action. If you prefer the Supabase Dashboard, open **Edge Functions → janwatch-ai** and deploy the updated `supabase/functions/janwatch-ai/index.ts` code there.

## 4. Test AI after deployment

1. Sign in to LokPravaah.
2. Open Admin → Feature switches and make sure **LokPravaah AI assistant** is ON.
3. Click **Test AI connection**.
4. If it fails, open Supabase → Edge Functions → `janwatch-ai` → Logs. Check provider authentication, quota, model access, and network errors. The UI now distinguishes missing keys from provider failures.

Cloudflare Pages only builds/hosts the React frontend. It does not deploy Supabase functions or supply provider keys to them.

## 5. Configure gift cards in Admin

1. Open Admin → Rewards & withdrawals.
2. Enable **Gift card** under withdrawal methods.
3. Add any brand and its minimum/maximum rupee amount (for example Amazon ₹100–₹5,000, or Google Play/Croma/PVR with their own limits).
4. Save each brand's limits and save the overall reward rules.
5. A citizen selects the brand and requests points. The server validates both global point limits and that brand's rupee limits.
6. Approve the request in the admin withdrawal queue, paste the real gift card code, and choose **Deliver gift card code**.
7. The code appears in that user's **Rewards & withdrawals → Withdrawal requests** history, with a copy button. No email or SMS is sent.

The admin must own or lawfully obtain valid gift card codes. This feature records and delivers codes; it does not purchase or generate gift cards automatically.

## Important

The repository build cannot be confirmed in this environment because dependencies could not be fully installed. Let Cloudflare Pages run its normal build after committing, and check its result. The live AI cannot be verified from source code alone without the Supabase project's actual secrets and deployment state.


IMPORTANT SQL Editor note (v4): download and run the entire `supabase/lokpravaah_ai_giftcard_repair.sql` file. Do not run a highlighted/selected fragment. Before clicking Run, confirm the last line is `notify pgrst, 'reload schema';`. The migration now adds `enabled_payout_methods` when absent.
