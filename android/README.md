# LokPravaah Android app

This Android app provides a native Compose citizen experience for login, reports, AI, community, rewards, referrals, support, profile, downloads and navigation. The donation screen intentionally loads the production donation route inside the app so it uses the exact original bundled Youpi checkout/modal and manual UTR/receipt review flow rather than a separate native UPI implementation. Admin management remains website-only.

## Requirements
- Android Studio (current stable)
- JDK 17
- Android SDK Platform 35

## Build a debug APK
From the repository root:
```bash
cd android
gradle :app:assembleDebug
```
Or open the `android` directory in Android Studio and build the app. The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Behaviour and permissions
- HTTPS only; cleartext traffic is disabled and certificate errors are rejected.
- JavaScript, DOM storage, and cookies are used by the existing web app.
- Location and camera permissions are requested only when a web feature asks for them.
- File uploads use Android's system document picker rather than broad storage access.
- External web links are handled by the native screens or opened outside the app as appropriate.
- The startup sound can be toggled on the splash screen and from the account menu; the preference persists across launches.
- The debug APK uses a pinned development signing identity so successive debug builds can update each other. This key is only for development/test APKs and must never be reused for a Play Store release.
- The Android admin panel is deliberately omitted; admin management remains on the website.

## Native Supabase authentication foundation

The Android project now includes the Supabase Kotlin Auth client, email/password sign-in and sign-up operations, Google OAuth launch, PKCE callback handling, and the registered `lokpravaah://auth` deep link. The existing WebView entry point remains enabled until native auth and the core native citizen flows have been tested together; adding the SDK is not by itself proof that the full native app is release-ready.

Before enabling the native sign-in screen:
1. In Supabase Authentication → URL Configuration, add `lokpravaah://auth` to the redirect allow-list.
2. Confirm the existing Google provider is enabled and its Supabase callback is configured in Google Cloud.
3. Build with `SUPABASE_URL` and the public `SUPABASE_ANON_KEY` environment variables. Never package service-role or provider-secret keys.
4. Test email confirmation, Google OAuth return, restored sessions, logout, and website/app account consistency on a physical Android device.

The Kotlin SDK handles PKCE session exchange and persistence. Do not log callback URLs, access tokens, or refresh tokens.

## Important integration checks
The native shell reuses the production website and therefore the same Supabase backend and records. Before publishing, test login/signup, Google OAuth return flow, camera/file evidence upload, location permission prompts, downloads, browser back navigation, and all AI/payment/reward workflows on physical devices. Some browser-based OAuth/payment providers restrict embedded WebViews; if Google sign-in does not return correctly, move that flow to Custom Tabs/deep-link handling before release. Push notifications are not enabled merely by declaring notification permission; a push provider and token registration must be configured first.
