# LokPravaah — Implementation Status

## Implemented in source

- Visible brand updated to LokPravaah throughout the landing page, app workspace, creator section, toolkit, admin labels and AI assistant. Existing deployed Supabase identifiers (`janwatch-ai`, `janwatch_ai`, `is_janwatch_admin`) are preserved to avoid breaking the current database/function integration.
- Public welcome-first experience with Sign in/Register and a **Creator of this website** section for Aditya Ratre. Portfolio links open in a separate tab.
- Responsive layout breakpoints, mobile drawer behavior, narrow-screen navigation sizing, overflow wrapping for creator/AI text, touch-friendly public navigation and reduced-motion support.
- SEO metadata in `index.html`: title, description, keywords, indexing directives, Open Graph/Twitter card metadata, favicon, web manifest and JSON-LD describing the independent civic-tech application. Canonical URL and absolute social-image links are injected only when a real HTTPS `VITE_SITE_URL` is present.
- Branded 1200×630 social preview image; production build generates `robots.txt` and `sitemap.xml` when `VITE_SITE_URL` is configured. The build deliberately avoids inventing a production domain.
- Existing citizen workflows: Supabase email/password and Google auth, onboarding/profile, civic reports and status updates, optional evidence storage, public report browsing, map focus, support voting and export.
- Existing public community chat/moderation, admin feature switches and announcements, reward ledger and manual withdrawal request workflow, and editable complaint/RTI/project-review toolkit.
- LokPravaah AI source using server-side provider keys, authentication checks, admin feature-flag check, prompt/output limits, request throttling, bounded provider timeouts, and fallback across up to three configured OpenRouter free models, optional Gemini, optional Groq, then an honest manual fallback without fabricated answers.
- Preferred server settings are `LOKPRAVAAH_AI_ENABLED` and `LOKPRAVAAH_SITE_URL`; legacy `JANWATCH_AI_ENABLED` and `JANWATCH_SITE_URL` remain accepted for compatibility.

## Required operational setup / limitations

- AI Edge Function is included in source but is **not deployed from this environment**. Configure server-side keys in Supabase Edge Function Secrets and deploy `supabase functions deploy janwatch-ai` before AI requests can work.
- Actual AI responses depend on valid provider keys, current model IDs, provider quotas, and optional backup switches. Gemini and Groq backup switches are off by default, and paid OpenRouter models are blocked by default.
- Money withdrawal is a request/approval tracker only. Transfers must be made externally; there is no automatic UPI/bank payout integration.
- Reports and complaint/RTI drafts are not automatically submitted to government departments. LokPravaah is an independent civic-tech project, not an official government service or emergency channel.
- Retrieval-grounded legal answers with maintained legal citations, OCR/document analysis, official department dispatch/status sync, public-project data ingestion and independent verification are not included.
- Production domain, real SEO indexing, OAuth redirects, database policies, evidence storage, provider API calls, rewards, and real-device responsiveness must be tested against the user's deployment.

## Checks and known environment limitation

- The original project archive could be read and updated, and the generated archive will be checked for ZIP integrity.
- `npm install --no-audit --no-fund` timed out in this environment. Consequently `npm run build` could not pass here because dependencies such as React, Vite and Supabase SDK were absent. Do not treat this package as build-verified until dependencies install and `npm run build` succeeds.
- We will still run dependency-free JavaScript/TypeScript syntax parsing, JSON/SEO generator checks, file integrity checks, and inspect the generated production SEO paths before delivery.

## First run

1. Extract `LokPravaah_Premium_MVP_FINAL.zip` and copy the existing safe `.env` containing only the public Supabase URL/key into the project root. Never put service-role, provider or payment secrets in Vite variables.
2. Run `npm install`, then `npm run build`, then `npm run dev`.
3. For production SEO, set `VITE_SITE_URL` to the actual HTTPS site origin before building. Submit the generated `sitemap.xml` in Google Search Console after deploying to that same domain.
4. Review and apply `supabase/v4_platform_migration.sql` if the platform migration has not already been applied; use `supabase/lokpravaah_branding_patch.sql` only for an existing feature-label update. Review the existing project schema/policies before modifying a live database.
5. Configure Edge Function secrets and deploy `janwatch-ai`, then test citizen and admin flows on desktop and real mobile devices before public launch.


## October 2026 polish pass (source changes; deployment still required)

- Redesigned public welcome page layout and added dedicated in-page views for How it works, Blog & Updates, and Support/Creator; navigation is hash-addressable and supports browser back/forward.
- Added `site_posts` super-admin editor workflow (create/edit/publish/unpublish/delete) with HTTPS related links and row-level security migration in `supabase/updates_blog_migration.sql`.
- Removed non-functional workspace dropdown affordance; admin console entry now appears in the sidebar for recognized roles. Role loading uses `janwatch_current_user_role()` with a direct-read fallback and is independent of report query success.
- Added database-stamped chat role tags and Enter-to-send / Shift+Enter newline to community chat and AI prompt; send failures now reset composer loading state and show a retry-oriented error.
- Expanded AI Edge Function CORS headers and made network/function deployment errors more actionable in the UI. Also aligned the `janwatch_ai` feature flag with the database check constraint so its admin toggle can persist.
- Syntax transpilation checks pass for TS/TSX source. `npm install --no-audit --no-fund` timed out in this environment, so a full dependency-backed production build and browser/Supabase live test remain unverified. The AI function still needs deployment and valid server-side provider secrets in the user's Supabase project.
