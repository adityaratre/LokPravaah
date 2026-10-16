# LokPravaah — Civic Reporting & Accountability Platform

LokPravaah is a Supabase-backed civic-reporting MVP with an explicit public welcome page, sign-in/register flow, citizen profiles, real report records, community chat, moderated admin operations, site-wide announcements, feature switches, an audit log, and a reward ledger with manual withdrawal requests.

> **Status:** Source package syntax and ZIP integrity are checked. This is not a production-validated government service. A full Vite build and live authentication/database end-to-end test still need to be run in your environment.

## Included in this release

### Citizen experience
- Public landing page always appears first, including when a session is stored. The welcome page offers **Sign in** and **Register**—not a “switch user” action.
- Supabase email/password registration and sign-in, Google OAuth, password reset, and confirmation-resend UI. Email delivery is still controlled by Supabase settings and SMTP/rate limits.
- First-time profile setup: full name, city/town, ward/local area, optional phone, participation type, and preferred civic category.
- Database-backed report submission, category, address, optional geolocation, private evidence upload, report browsing, search/filter, report detail, status events, community support votes, map focus, and report-data export.
- Rule-based *suggested severity* and *possible duplicate candidate* prompt. These are transparent heuristics, not an AI model, emergency assessment, or independent verification; candidates do not automatically block a report.
- Collapsible desktop sidebar (compact icon rail / expanded navigation), responsive mobile drawer, visible close button, backdrop-to-close, and Escape-to-close. Preference is kept locally.
- Profile details and real report counts; no seeded demo reports or fabricated impact-score display.
- Public community chat with flag/report message action; moderation supports hide/restore/delete.
- Civic Toolkit with editable/downloadable complaint and RTI drafts, project-evidence checklist, and official grievance portal links. LokPravaah does not file those drafts with government portals.
- Reward points ledger and withdrawal request status history.

### Admin / moderator controls
- Admin entry only appears for a user whose assigned role is returned by `public.user_roles`. Citizen profile type does not grant admin permissions.
- Feature flags to pause reporting, chat, rewards, civic toolkit, evidence uploads, and support voting; important data writes also check relevant feature flags in database policies/functions.
- Create/expire/hide/delete site-wide announcements.
- Community message moderation and flag queue.
- Reward rules: enable/disable points, configure report-milestone points and threshold/rate, enable/disable cash-redemption requests, grant reviewed manual points, and approve/reject withdrawal requests.
- Super-admin role assignment workflow, protection against self-demotion and removing the last super-admin, and recent audit-log viewer.
- “Mark paid” requires an external transaction reference after an authorised person has actually sent a UPI payment.

## Rewards and money withdrawals — important

Points are ledger entries, not cash held in a bank account. Configured points can be granted after an authorised LokPravaah reviewer moves a public report to the `verified` or `resolved` status; this is **not** independent government verification. An administrator may also grant points with a reason. The database checks balance and reserves eligible points when a withdrawal request is created. Rejected requests release the reservation.

The withdrawal UI currently supports **UPI ID + request + administrator approval/rejection + external transaction reference**. It does **not** send real money automatically. Do not enable cash redemptions until you have funding, programme rules, fraud review, legal/tax review, and a secure authorised payout provider/process. A real automated payout integration needs a server-side service and private provider credentials; never put those secrets in frontend `.env` variables.

## Not included / not claimed as complete

- Retrieval-grounded legal answers with maintained citations; OCR/legal document analysis. The multi-provider AI function source is included, but it is not live until secrets are configured and the Edge Function is deployed.
- Independent official public-project verification or an official project records ingestion feed.
- Official department dispatch, government grievance submission, municipal status sync, or officer portal integrations.
- Push/email notification delivery. The bell is explicitly recent-report activity; site-wide announcement alerts are a separate feature.
- Automated payout to UPI/bank, lawyer verification directory, full Hindi translation, final production deployment, and independent security/accessibility review.

These require more services, official sources/API access, operational processes, and deployment/security validation. Do not present LokPravaah as an official government grievance portal or emergency service.

## October 2026 polish patch: public pages, chat roles, admin publishing and AI diagnostics

This updated ZIP adds dedicated Home, How it works, Blog & Updates and Support views. The Support page includes the creator details; the left workspace card is now informational (no nonfunctional drop-down arrow); and the admin-console entry is independent of report-loading success. A super-admin-only **Content & blog** tool can create, edit, publish, unpublish and delete blog articles, app updates and feature updates with a related HTTPS link. Public posts are rendered as plain text; HTML is not executed.

### Run the additional database patch

Because you have already run the earlier platform migration, also run `supabase/updates_blog_migration.sql` in Supabase Dashboard → SQL Editor. It creates the `site_posts` table with public-read-for-published / super-admin-write policies, adds database-stamped `author_role` tags for chat messages, creates a secure current-role RPC to restore the admin entry, and adds the `janwatch_ai` feature flag constraint/value. Run the earlier `supabase/v4_platform_migration.sql` first if it has not already been installed. The additional patch is designed to be re-runnable; back up production data before schema changes.

### Why LokPravaah AI can show “Failed to send a request to the Edge Function”

The browser app cannot deploy a Supabase Edge Function by itself. The updated function now allows the Supabase JS client headers during CORS preflight and the UI explains likely deployment/project/network errors. To actually serve AI responses, open a terminal in this project linked to the same Supabase project and deploy the included function:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy janwatch-ai
```

Then configure server-side Edge Function secrets in Supabase Dashboard → Edge Functions → Secrets (never in `.env` or any `VITE_*` variable):

- `OPENROUTER_API_KEY` — a valid OpenRouter API key for the primary provider (the Gemini key can still provide backup if OpenRouter is temporarily unavailable)
- `OPENROUTER_MODELS` — comma-separated, current model IDs that are available on your OpenRouter account; use `:free` IDs unless you intentionally enable paid models
- Gemini backup: `GEMINI_API_KEY` (enabled by default when the key exists; set `AI_ENABLE_GEMINI_BACKUP=false` to disable). Optional Groq backup: `GROQ_API_KEY` and `AI_ENABLE_GROQ_BACKUP=true`.
- Optional: `LOKPRAVAAH_AI_ENABLED=true`

Redeploy the function after changing code. Then test while signed in, inspect Supabase → Edge Functions → `janwatch-ai` → Logs, and test the manual fallback path too. If the CORS change was the cause, redeploying this version may fix it; if the function is not deployed or provider secrets/models are invalid, frontend code alone cannot make a live provider reply.

### Keyboard shortcuts

- In LokPravaah AI and public chat, **Enter sends** and **Shift+Enter inserts a new line**. The Send button remains available for touch/mobile users.
- Chat role badges (`Member`, `Moderator`, `Admin`, `Super admin`) come from the database trigger and must not be set by browser input.

## Requirements

- Node.js 20+ recommended
- npm
- A Supabase project
- Google OAuth provider configured if you want Google sign-in

## Setup on Windows

1. Extract the ZIP into a **new folder** and copy your previous project's `.env` into the inner `LokPravaah_Premium_MVP` folder. The ZIP deliberately contains no `.env` secrets.
2. Open Command Prompt in the inner `LokPravaah_Premium_MVP` folder.
3. Install and build:

   ```bat
   npm install
   npm run build
   ```

4. Run the local site:

   ```bat
   npm run dev
   ```

5. Open the **exact localhost URL printed by Vite**. Stop old Vite terminals with `Ctrl+C` first so you do not accidentally view an older build. `vite.config.ts` uses a strict local port so it does not silently move from port 5173 to 5174.

`START_LOKPRAVAAH.bat` is also included.

## Environment variables

Keep the existing working public client values in `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

Never place a Supabase `service_role`, model-provider key, SMTP password, UPI secret, or payout provider secret in a `VITE_*` browser variable.

## Supabase setup / migration (existing project)

You already have the base tables and an earlier onboarding patch in your existing LokPravaah database. For this release ZIP, if the platform schema is already installed, run this additional update migration after reviewing it:

`supabase/updates_blog_migration.sql`

If the platform schema has not been installed, first run `supabase/v4_platform_migration.sql` and then run `supabase/updates_blog_migration.sql`.

If the SQL Editor shows your account as `super_admin` but the website still labels you `Member` or hides the Admin console, also run `supabase/role_access_fix.sql` in that same Supabase project. It creates the signed-in user's role-check endpoint, permits users to read only their own assigned role, and backfills chat role badges. It does not grant or promote any account. After running it, use **My profile → Refresh platform role** or sign out and sign back in.

**How to run it:** Open the `.sql` file in a text editor, copy the **contents of the file**, paste those SQL statements into Supabase Dashboard → SQL Editor, and click **Run**. Do not paste the file path as SQL. This migration is designed to be re-runnable on the V3 schema; still review the file and back up important data before production changes.

It adds the `suggested_severity` field, platform feature flags, site announcements, chat + moderation, rewards ledger/settings, manual withdrawal requests, server-side functions, RLS policies, audit events, and Realtime publication entries.

### Authentication setup

In Supabase Dashboard → Authentication → URL Configuration:
- Local Site URL: `http://localhost:5173`
- Redirect URL: `http://localhost:5173/**`

Confirm Google OAuth is enabled and its Supabase callback is configured with the correct Google client details. Email confirmation and recovery email delivery depend on your project configuration. Supabase's default email sender is heavily rate limited; configure custom SMTP for reliable signup/confirmation/reset emails. Do not turn off email confirmation for an internet-facing production site just to hide a delivery problem.

### Assign the first super administrator

1. Register and verify the intended administrator account.
2. In Supabase Dashboard → Authentication → Users, copy that user's exact UUID.
3. In SQL Editor, replace `AUTH-USER-UUID` below with the real UUID, then run:

   ```sql
   insert into public.user_roles (user_id, role)
   values ('AUTH-USER-UUID', 'super_admin')
   on conflict (user_id) do update set role = excluded.role;
   ```

Only the role in `public.user_roles` grants admin access; choosing “volunteer” or “organisation” during profile setup never grants admin permissions.

## Validation checklist

After `npm run build` succeeds, test with separate normal citizen and admin test accounts:
1. Welcome page appears before login; it shows Sign in/Register, not Switch user.
2. Register/email confirmation or Google auth, then save the first-time profile.
3. Create a report, upload optional evidence, refresh the page, search/filter and open report status history.
4. Check candidate-duplicate prompt and suggested severity label are clearly described as heuristic guidance.
5. Send/flag/delete a chat message with a test account; hide/restore it as a moderator/admin.
6. Toggle each feature as admin, publish/dismiss a site announcement, and verify citizen controls and database write policies respect the switches.
7. Change a public test report to verified/resolved and confirm only the configured ledger points are recorded once.
8. Test a withdrawal request with test points; approve/reject it. Only use “mark paid” after a real authorised transfer has happened.
9. Confirm normal citizens cannot see admin controls or execute privileged database operations.
10. Test desktop collapse/expand, mobile drawer close, Escape key, light/dark appearance, and narrow-screen layouts.

A green TypeScript/Vite build checks compilation, not the full backend behaviour. Verify database policies and flows in the connected Supabase project before real use.

## Troubleshooting

- **Profile columns missing:** run the migration above and refresh the app.
- **Email signup/login says invalid credentials:** check whether the account exists and email is confirmed, then use password reset. Repeated signup/resend attempts can hit Supabase email limits; configure SMTP.
- **Admin console missing or chat still shows Member:** confirm the currently signed-in account UUID matches the row in `public.user_roles`. Run `supabase/role_access_fix.sql` if it has not been applied. Then use **My profile → Refresh platform role** or sign out and back in. In SQL Editor, replace `AUTH-USER-UUID` below with that exact UUID:

  ```sql
  select u.id as auth_user_id, u.email, ur.role, ur.assigned_by, ur.created_at
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  where u.id = 'AUTH-USER-UUID'::uuid;
  ```

  If this shows `super_admin`, redeploy this updated frontend, reload the site, and confirm `supabase/updates_blog_migration.sql` has been run on the same Supabase project. That migration stamps chat role badges and refreshes existing messages when role assignments change. Never grant roles to untrusted accounts.
- **Feature switches fail:** confirm the platform migration applied successfully and check the displayed database error. RLS is intentionally enforced server-side.
- **Withdrawal button unavailable:** rewards and cash-redemption controls must be enabled by an admin; available balance must meet the configured threshold. This only creates a request, not an automatic payment.
- **Sidebar remains in compact mode:** use the panel collapse/expand button in the workspace top bar. On mobile, open the menu then use the close button, backdrop, or Escape.

## Privacy / safety

Evidence files are private by default. Use only test data until policies have been validated. Never upload IDs or other sensitive data unless there is an approved need and retention policy. Browser geolocation is optional. LokPravaah is not an emergency channel and does not guarantee department action.

## Creator section
The public welcome page now includes a **Creator of this website** section for Aditya Ratre. Its portfolio link opens in a separate tab, so visitors do not get redirected away from LokPravaah.

## LokPravaah AI — 5-stage fallback
LokPravaah AI has its own dedicated sidebar section. Real model calls run only through the Supabase Edge Function `janwatch-ai`; provider keys must never be placed in Vite/client environment variables.

### Configure and deploy
1. In Supabase Dashboard → Edge Functions → Secrets, configure these server-side secrets:
   - `OPENROUTER_API_KEY` — required for the primary provider.
   - `OPENROUTER_MODELS` — comma-separated model IDs in preference order. List up to two currently available OpenRouter model IDs in fallback preference order; the function reserves a third attempt for `openrouter/free`.
   - `AI_ENABLE_GEMINI_BACKUP` — optional; defaults to `true` when `GEMINI_API_KEY` is configured (set `false` to disable Gemini backup).
   - `GEMINI_API_KEY` and optionally `GEMINI_MODEL` — configure this key to activate the automatic Gemini backup; it is enabled by default when the key exists.
   - `AI_ENABLE_GROQ_BACKUP` — optional, defaults to `false`.
   - `GROQ_API_KEY` and optionally `GROQ_MODEL` — only needed if enabling Groq.
   - `LOKPRAVAAH_AI_ENABLED` — new preferred global switch (defaults to `true`); set to `false` to disable AI globally. The legacy `JANWATCH_AI_ENABLED` variable remains accepted for backward compatibility.
   - `AI_ALLOW_PAID_OPENROUTER_MODELS` — defaults to `false`; non-free OpenRouter models are skipped unless explicitly enabled.
   - `LOKPRAVAAH_SITE_URL` — optional site URL used for provider request metadata. The legacy `JANWATCH_SITE_URL` is still accepted.
2. Deploy from the project folder with Supabase CLI linked to your project:
   `supabase functions deploy janwatch-ai`
3. Add/confirm the relevant secrets in the Supabase Dashboard. Do not commit keys or share them in chat.
4. Run the app, sign in, open the dedicated **LokPravaah AI** sidebar section, and ask a test question.

### What the fallback does
1. Attempts each configured OpenRouter model sequentially, respecting the configured order.
2. Attempts Gemini after OpenRouter fails, whenever `GEMINI_API_KEY` exists (backup is enabled by default; `AI_ENABLE_GEMINI_BACKUP=false` disables it).
3. Attempts Groq only if `AI_ENABLE_GROQ_BACKUP=true` and its key exists.
4. If all attempts fail or are not configured, returns an explicit unavailable state and does not invent an AI answer; manual civic drafting tools remain available.

The function applies a best-effort per-isolate request guard, limits prompts to 4,000 characters, caps generated output, limits each provider attempt to 12 seconds and total provider attempts to about 50 seconds, tries up to three unique OpenRouter models, checks the signed-in Supabase user, and logs provider/model/fallback level without logging prompt text or API keys. The request guard is best-effort per running isolate, not a global rate-limit service. Provider quotas, model availability, and any costs depend on your provider account and chosen models. Gemini backup is attempted automatically when `GEMINI_API_KEY` is configured (unless explicitly disabled); Groq backup remains opt-in. Paid OpenRouter models are blocked by default.

**Deployment status:** Source code is included in this ZIP, but the function is not deployed to your Supabase project from here. AI cannot answer until you configure server-side secrets and deploy the function.


## Search engine optimisation (SEO)

- The public entry page includes a clear page title and description, robots directives, Open Graph/Twitter metadata, a web manifest, favicon, and structured data describing LokPravaah as an independent civic-tech application. Absolute canonical/social URLs are added only when a real HTTPS `VITE_SITE_URL` is supplied.
- Add `VITE_SITE_URL=https://your-real-domain.example` to the production environment using your actual HTTPS website URL (no trailing slash). Do not use the creator portfolio URL here unless that is also the deployed LokPravaah website.
- The build generates `dist/robots.txt` and `dist/sitemap.xml` only when a valid production `VITE_SITE_URL` is configured. Without the real domain, it will not fabricate a sitemap URL.
- After deployment, submit `https://YOUR-REAL-DOMAIN/sitemap.xml` to Google Search Console and verify the actual domain. Rankings are not guaranteed by metadata alone.

## Mobile and release testing

Responsive breakpoints and touch-sized public navigation have been added for small phones, larger phones, tablets, and desktop screens. Before a public launch, test the deployed URL at 320 px, 360 px, 390 px, 768 px and desktop widths, plus keyboard navigation and screen-reader labels. A successful local build does not by itself prove the live Supabase backend, OAuth redirects, uploads, payments, or provider APIs work.

## Naming and backward compatibility

The visible product brand is **LokPravaah**. The existing Supabase function/table/policy identifiers (for example `janwatch-ai` and `janwatch_ai`) intentionally remain unchanged in this release so that renaming the UI does not break a function or database already deployed under those names. API keys belong only in Supabase Edge Function Secrets, never in Vite/browser variables.


## Privacy and browser storage

The app currently remembers interface preferences locally and Supabase's browser client manages its authenticated session. Do not store administrator roles, provider API keys, payment secrets, or privileged permissions in cookies or local storage. Role checks must continue to come from Supabase policies/functions. A cookie-consent banner is only useful when optional analytics, advertising, or similar non-essential tracking is actually integrated; do not enable analytics until the service and consent handling are configured.

## AI assistant setup (required for live answers)

The website calls the `janwatch-ai` Supabase Edge Function. Including the function in this ZIP does not deploy it to your live Supabase project. For the primary provider, open your Supabase project → Edge Functions → Secrets and set `OPENROUTER_API_KEY` to your own key and `OPENROUTER_MODELS=openrouter/free` (or leave the model secret unset to use the built-in free-router fallback). `OPENROUTER_MODELS` may be set to `openrouter/free` (the function now also defaults to this route when the model list is absent). Keep provider keys in Edge Function secrets; never add them to `VITE_` variables or commit them to source control.

From a terminal opened at this project folder, deploy the function to your Supabase project:

```bash
npx supabase login
npx supabase link --project-ref zfcvfkchttpisuizndur
npx supabase functions deploy janwatch-ai --project-ref zfcvfkchttpisuizndur
```

Then sign in to LokPravaah, open Admin console → Platform controls → Feature switches, and click **Test AI connection**. If the test fails, open Supabase Dashboard → Edge Functions → `janwatch-ai` → Logs and inspect the latest failure. This source tries configured free models and then the OpenRouter free router; it still needs a valid server-side `OPENROUTER_API_KEY` and a deployed function. Source-code changes alone cannot activate hosted AI.

## Report and payout repair migration

After the existing V4 platform migration, run `supabase/admin_reports_payout_methods_patch.sql` in Supabase SQL Editor. It restores admin report/evidence read policies, adds method-aware withdrawals (UPI, bank transfer, gift card delivery), and adds an audited admin point adjustment RPC that supports both grants and deductions. The admin Reports tab has a refresh/retry state; the View details action loads the latest full report and status timeline. In the Admin Console → Platform controls → Rewards & withdrawals, select enabled payout methods and save. Withdrawal processing is manual: the administrator must complete the bank transfer or gift-card delivery externally and then record its real reference. Do not collect UPI PINs, OTPs, passwords or card credentials.

