# LokPravaah Native Android Architecture

## Product boundary
- The existing React website remains unchanged in UI and keeps its current routes.
- The Android client is being rebuilt as a native Kotlin + Jetpack Compose application; it must not render the production website inside a WebView as its primary UI.
- Both clients use the existing Supabase project, tables, storage buckets, auth identities, server-side policies and existing business rules. Do not create a second set of users, reports, points, leaderboard records, rewards or admin data.

## Shared-data invariants
1. Supabase is the source of truth for users, civic reports, evidence metadata, votes, points, referrals, rewards, chat, support tickets and payment records.
2. Leaderboards are read from the same authoritative query/view/function used by the website. The app must not calculate or persist a separate ranking.
3. Awarding points, resolving reports, referrals, donation confirmation and other sensitive transitions must be validated server-side; never trust a client-provided total.
4. Preserve existing RLS policies. A new client must not weaken policies or embed service-role secrets.
5. Use existing database tables and RPC/functions where compatible. Any schema migration must be backward-compatible and separately reviewed.
6. Admin panel remains the single administration surface. Native push notifications need a server-authorized send workflow and device-token registration; client apps must never send privileged push requests directly.

## Native implementation sequence
1. Audit current schema, RLS, auth redirects, storage policies, RPCs, edge functions, leaderboard query and admin notification capability.
2. Add native brand tokens/components and app navigation.
3. Implement Supabase auth with Google OAuth deep-link/App Link callback and session restore.
4. Implement core reports, uploads, status, map and leaderboard against existing backend.
5. Implement community, chat, rewards, AI, worker/referral, support, donations and downloads.
6. Add admin-triggered push notifications through a trusted server function.
7. Cross-client integration tests: create/update in website, verify in app and vice versa; verify one leaderboard and one points history.
8. Build and test on physical Android devices before release.

## Release gate
Do not switch the production app away from its current entry point until native authentication and the core citizen flows are connected to the shared backend and verified. A successful APK build alone is not feature verification.


## Google OAuth / native callback setup (in progress)

The native auth screen is still presentation-only until the shared Supabase client and session lifecycle are wired. Android now reserves the callback URI `lokpravaah://auth/callback`.

Before end-to-end testing:
1. Enable Google in the existing Supabase project's Authentication → Providers.
2. Set the Google provider's authorized redirect URI to the Supabase Auth callback shown in provider settings (usually `https://<project-ref>.supabase.co/auth/v1/callback`).
3. Add `lokpravaah://auth/callback` to Supabase Authentication → URL Configuration → Redirect URLs.
4. Keep the website's existing redirect URLs unchanged.
5. Use only the public anon/publishable key in Android; never embed service-role keys or Google client secrets.
6. Implement and verify callback token/code exchange and session persistence before enabling the native screen in MainActivity.

Registering a callback URI alone does not complete OAuth. The production entry point remains the existing WebView until session handling and shared-account tests pass.
