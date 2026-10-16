# LokPravaah AI language + gift-card UI patch

## AI language behavior
- The frontend detects the latest question as English, Hindi (Devanagari), or Hinglish (Roman Hindi mixed with English).
- The selected language is passed as `response_language` to the `janwatch-ai` Supabase Edge Function.
- The Edge Function adds a mandatory language policy to the system prompt for OpenRouter, Gemini, and Groq calls.
- AI chat answers now have a Copy answer action and the composer shows the detected reply language.

## Gift-card administration and visibility
- Admin gift-card catalogue is visible even before Gift card is enabled as a payout method.
- If `reward_gift_card_options` is missing or inaccessible, the admin sees an explicit migration/database warning instead of a silently empty catalogue.
- The user Rewards screen shows a specific warning when gift-card options cannot load.
- Per-brand limits, global min/max points, and in-app code delivery remain enforced by the SQL RPCs in `supabase/lokpravaah_ai_giftcard_repair.sql`.

## Required database setup
Run the entire raw file `supabase/lokpravaah_ai_giftcard_repair.sql` from Supabase SQL Editor. Do not copy a partial function from a rendered chat preview. If using Windows, open the downloaded `.sql` file in Notepad, copy the whole file, paste into a new SQL Editor query, and run it.

## Deployment
- Deploy the frontend root to Cloudflare Pages from the repository root.
- Deploy `supabase/functions/janwatch-ai/index.ts` as the `janwatch-ai` Edge Function after updating it.
- Confirm `OPENROUTER_API_KEY` or `GEMINI_API_KEY` is configured in Supabase Edge Function Secrets.

## Verification status
Source changes and migration presence were checked. A production build could not be certified in this environment because the package dependencies are not installed and network installation is unavailable. Live Supabase migration and AI provider execution must be verified in the user's project.
