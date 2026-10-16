# LokPravaah — Implementation Status

## Implemented in source

- Visible brand updated to LokPravaah throughout the landing page, app workspace, creator section, toolkit, admin labels and AI assistant. Existing deployed Supabase identifiers (`janwatch-ai`, `janwatch_ai`, `is_janwatch_admin`) are preserved to avoid breaking the current database/function integration.
- Public welcome-first experience with Sign in/Register and a **Creator of this website** section for Aditya Ratre. Portfolio links open in a separate tab.
- Responsive layout breakpoints, mobile drawer behavior, narrow-screen navigation sizing, overflow wrapping for creator/AI text, touch-friendly public navigation and reduced-motion support.
- SEO metadata in `index.html`: title, description, keywords, indexing directives, Open Graph/Twitter card metadata, favicon, web manifest and JSON-LD describing the independent civic-tech application. Canonical URL and absolute social-image links are injected only when a real HTTPS `VITE_SITE_URL` is present.
- Branded 1200×630 social preview image; production build generates `robots.txt` and `sitemap.xml` when `VITE_SITE_URL` is configured. The build deliberately avoids inventing a production domain.
- Existing citizen workflows: Supabase email/password and Google auth, onboarding/profile, civic reports and status updates, optional evidence storage, public report browsing, map focus, support voting and export.
- Existing public community chat/moderation, admin feature switches and announcements, reward ledger and manual withdrawal request workflow, and editable complaint/RTI/project-review toolkit.
- LokPravaah AI has its own sidebar workspace with General AI, Legal & Rights, Civic Assistant, and Document AI modes; it supports in-session per-mode conversation context, clear-current-chat/new-chat controls, provider attribution, a typing indicator, and reduced-motion-aware animation.
- Preferred server settings are `LOKPRAVAAH_AI_ENABLED` and `LOKPRAVAAH_SITE_URL`; legacy `JANWATCH_AI_ENABLED` and `JANWATCH_SITE_URL` remain accepted for compatibility.

## Required operational setup / limitations

- AI Edge Function is included in source but is **not deployed from this environment**. Configure server-side keys in Supabase Edge Function Secrets and deploy `supabase functions deploy janwatch-ai` before AI requests can work.
- AI calls run through the authenticated Supabase Edge Function. OpenRouter is tried first (configured models, then `openrouter/free`); Gemini is automatically tried when `GEMINI_API_KEY` exists unless explicitly disabled. Groq remains opt-in. Actual responses still depend on valid server-side keys, model availability, quotas and successful function deployment; paid OpenRouter models are blocked by default.
- Money withdrawal is a request/approval tracker only. Transfers must be made externally; there is no automatic UPI/bank payout integration.
- The Rewards repair SQL now adds/normalises `enabled_payout_methods` before selecting it and inserts a default singleton setting only when absent; the V4 schema migration also includes the field for future installations. Reports and complaint/RTI drafts are not automatically submitted to government departments. LokPravaah is an independent civic-tech project, not an official government service or emergency channel.
- Retrieval-grounded legal answers with maintained legal citations, OCR/document analysis, official department dispatch/status sync, public-project data ingestion and independent verification are not included.
- Production domain, real SEO indexing, OAuth redirects, database policies, evidence storage, provider API calls, rewards, and real-device responsiveness must be tested against the user's deployment.

## Checks and known environment limitation

- The original project archive could be read and updated, and the generated archive will be checked for ZIP integrity.
- `npm install --no-audit --no-fund` timed out in this environment. Consequently `npm run build` could not pass here because dependencies such as React, Vite and Supabase SDK were absent. Do not treat this package as build-verified until dependencies install and `npm run build` succeeds.
- We will still run dependency-free JavaScript/TypeScript syntax parsing, JSON/SEO generator checks, file integrity checks, and inspect the generated production SEO paths before delivery.

## First run

1. Extract this LokPravaah source archive. Copy `.env.example` to `.env` and fill only the public Supabase project URL and publishable/anon key. Never put service-role, OpenRouter, Gemini or payment secrets in Vite variables.
2. Run `npm install`, then `npm run build`, then `npm run dev`.
3. For production SEO, set `VITE_SITE_URL` to the actual HTTPS site origin before building. Submit the generated `sitemap.xml` in Google Search Console after deploying to that same domain.
4. Review/apply the required Supabase migrations against your existing database. For the previously reported Rewards error, run `supabase/lokpravaah_rewards_repair.sql` after confirming `public.reward_settings` exists. Review the current schema and policies before modifying a live database.
5. Configure Edge Function secrets and deploy `janwatch-ai`, then test citizen and admin flows on desktop and real mobile devices before public launch.


## October 2026 polish pass (source changes; deployment still required)

- Redesigned public welcome page layout and added dedicated in-page views for How it works, Blog & Updates, and Support/Creator; navigation is hash-addressable and supports browser back/forward.
- Added `site_posts` super-admin editor workflow (create/edit/publish/unpublish/delete) with HTTPS related links and row-level security migration in `supabase/updates_blog_migration.sql`.
- Removed non-functional workspace dropdown affordance; admin console entry now appears in the sidebar for recognized roles. Role loading uses `janwatch_current_user_role()` with a direct-read fallback and is independent of report query success.
- Added database-stamped chat role tags and Enter-to-send / Shift+Enter newline to community chat and AI prompt; send failures now reset composer loading state and show a retry-oriented error.
- Expanded AI Edge Function CORS headers and made network/function deployment errors more actionable in the UI. Also aligned the `janwatch_ai` feature flag with the database check constraint so its admin toggle can persist.
- Syntax transpilation checks pass for TS/TSX source. `npm install --no-audit --no-fund` timed out in this environment, so a full dependency-backed production build and browser/Supabase live test remain unverified. The AI function still needs deployment and valid server-side provider secrets in the user's Supabase project.


## 16 October 2026 — General AI and Rewards compatibility repair

- Added LokPravaah AI as a separate sidebar section controlled by the existing `janwatch_ai` feature flag, instead of nesting it under Civic toolkit.
- Added General AI, Legal & Rights, Civic Assistant and Document AI mode navigation; chat history is separated by mode, the clear-chat action only clears the active mode, New Chat clears all modes, and provider attribution displays OpenRouter/Gemini when returned by the server.
- Automatic Gemini fallback is enabled by default whenever `GEMINI_API_KEY` exists, unless explicitly disabled; the configured OpenRouter model tries and `openrouter/free` fallback are preserved.
- Fixed the Rewards repair SQL to add `enabled_payout_methods` before selecting it, normalise old values, and preserve existing reward thresholds/toggles; updated the V4 migration for new databases.
- TypeScript/TSX syntax transpilation passed for the app and Edge Function. Full Vite/TypeScript build, deployed Supabase migration, live provider requests and live browser behavior remain unverified because dependency installation timed out and this workspace has no access to the user's hosted project or secrets.

## 16 October 2026 — follow-up fix pass on latest uploaded source

- Fixed the CI TypeScript error in `src/components/JanwatchAI.tsx`: user and assistant messages are built as explicit `ChatMessage` objects so `role` remains the `'user' | 'assistant'` union rather than widening to `string` inside the React state updater.
- Fixed cross-mode AI UI state: an in-flight response and its typing indicator are associated with the mode that initiated the request, so changing modes does not show the response/loader in the wrong chat. Clear/New Chat controls are disabled while a request is in flight, and validation errors clear while the user edits the prompt.
- Fixed the Rewards payout-method fallback so a missing/empty legacy value shows UPI consistently in the selector and request validation.
- Fixed the Admin Rewards save path so the no-payout-method validation runs before setting the busy/loading state; it no longer leaves the save button stuck when validation fails.
- Added an explicit readonly tuple-array type for Admin Console tabs, avoiding a tuple inference issue under stricter TypeScript checking.
- Static TS/TSX transpilation passed for all 9 source files, and targeted strict TypeScript checking passed for the modified AI, Rewards and Admin components with temporary ambient declarations. JavaScript syntax and JSON manifest checks passed.
- A full dependency-backed production build could not be run here: `npm ci` attempted to download dependencies but the registry lookup failed with `EAI_AGAIN`. This is a sandbox network limitation, not a successful build. Re-run `npm ci && npm run build` in the repository CI/deployment environment to confirm the complete build with the actual dependency types.
- SQL migrations, live Supabase policies, provider API calls and browser/device behavior were not executed against the hosted project. Apply migrations and deploy the Edge Function only after reviewing the target project's migration history and server-side secrets.
