# LokPravaah — latest source repair notes

This ZIP starts from the latest uploaded `LokPravaah_Fixed_OpenRouter_Gemini` source.

## Code changes

- Resolved the `TS2345` issue in `src/components/JanwatchAI.tsx` by explicitly typing each new message as `ChatMessage`, preserving `role: 'user' | 'assistant'`.
- AI responses and the loading indicator are now tied to the mode that launched the request. Changing tabs during an in-flight request cannot place the response/typing indicator in a different mode.
- AI Clear/New Chat actions are disabled while a response is in flight; editing the prompt clears the previous validation message.
- Rewards uses the same UPI fallback in the payout selector and client-side validation when a legacy database row has a missing/empty payout-method array.
- Admin Reward settings validates that at least one payout method is enabled before entering the busy state, preventing a permanently disabled Save button after validation failure.
- Admin Console tab tuples have an explicit readonly tuple-array type for consistent inference.

## AI provider setup

The function source still uses OpenRouter first (configured free models and then `openrouter/free`), Gemini as the automatic backup when `GEMINI_API_KEY` exists, and Groq only when explicitly enabled. The default Gemini model remains `gemini-3.8-flash`; confirm valid keys, quotas and model availability in the provider accounts. Provider keys belong only in Supabase Edge Function Secrets, never in the browser `.env` or `VITE_*` variables.

For deployment, link the local Supabase CLI to the intended project, review the actual migration history, apply the needed SQL patch in that project, set server-side secrets, then deploy `supabase/functions/janwatch-ai/index.ts` as `janwatch-ai`.

## Checks and remaining deployment work

- Passed: syntax/transpilation checks for all 9 TS/TSX source files and the Edge Function; JSON manifest parsing; JavaScript syntax checks; targeted TypeScript checks for the modified AI, Rewards and Admin components using temporary external-package declarations.
- Not verified: complete Vite production build with installed project dependencies. This environment's `npm ci` hit DNS `EAI_AGAIN` while fetching the npm registry, so the real dependency-backed build must still be run in CI or on a network-enabled machine.
- Not verified: SQL execution against the actual Supabase database, live OpenRouter/Gemini requests, deployed Edge Function behavior, auth/RLS policy behavior or real-device responsive layout.

Do not interpret this source ZIP as an automatic deployment or as proof that the hosted website/database has already been updated.
