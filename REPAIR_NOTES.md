# LokPravaah Repair Build — General AI, Provider Fallback and Rewards

This archive contains source-code changes. It does not automatically deploy the website, Edge Function or SQL migration to your hosted Supabase project.

## Included changes

- LokPravaah AI now has General AI, Legal & Rights, Civic Assistant and Document AI modes in one dedicated workspace.
- General mode is a general-purpose conversational assistant; the legal mode uses stricter jurisdiction-aware instructions and must not invent statutes, sections or sources.
- The UI keeps a short in-session conversation context, supports New Chat and Clear Conversation, and adds responsive animated mode cards and chat bubbles with reduced-motion support.
- The existing OpenRouter fallback sequence is preserved. Gemini backup is now attempted automatically when `GEMINI_API_KEY` is configured, unless `AI_ENABLE_GEMINI_BACKUP=false` is explicitly set. Groq remains opt-in.
- Provider keys remain server-side in Supabase Edge Function Secrets; never add provider keys to `VITE_` variables or commit them.
- `supabase/lokpravaah_rewards_repair.sql` adds the missing `enabled_payout_methods` column safely on older installations, normalises payout-method values, and restores the singleton `reward_settings` row only if missing. It preserves existing reward thresholds and switches.

## Deploy / configure

1. Back up your current project and preserve the existing `.env` values.
2. In Supabase Dashboard → Edge Functions → Secrets, confirm `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` (optional; falls back to `openrouter/free`), and `GEMINI_API_KEY` are set. If Gemini is configured, it is now used as a backup by default. Set `AI_ENABLE_GEMINI_BACKUP=false` only if you want to disable it.
3. Deploy the updated Edge Function from the project root:

   ```bash
   npx supabase functions deploy janwatch-ai --project-ref zfcvfkchttpisuizndur
   ```

4. In Supabase SQL Editor for the same project, run `supabase/lokpravaah_rewards_repair.sql`. This specifically fixes the `enabled_payout_methods does not exist` error before the final verification query. If `reward_settings` does not exist, first apply the existing `supabase/v4_platform_migration.sql` according to your migration history.
5. Run `npm ci`, then `npm run build`, and deploy the generated `dist` folder using your existing hosting workflow.
6. Sign in and test each AI mode. Test provider fallback by temporarily configuring an invalid OpenRouter model (not by deleting production keys), then inspect Supabase Edge Function logs. Restore valid settings immediately afterward.
7. Open the dedicated **LokPravaah AI** sidebar section to test the four modes. Open Rewards, tap Refresh and verify that settings, balance and history load. If it still fails, check Supabase API errors and policies; a source ZIP cannot repair project-specific deployment mismatches until the updated function and SQL are applied.

## Honest validation status

- Archive integrity and source-level changes were checked in this workspace.
- A full TypeScript/Vite production build could not be completed because dependency installation timed out in this environment.
- Live provider requests, the deployed Supabase function, database migrations/RLS, and Rewards API were not testable from this workspace. Do not treat this source ZIP as proof that the live website is already fixed; deploy and run the checks above.
