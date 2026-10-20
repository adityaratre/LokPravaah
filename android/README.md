# LokPravaah Android app

This Android app provides a native animated launch experience and a secure Android WebView shell for the existing LokPravaah web application. The web app remains the source of truth for accounts, reports, AI, rewards, and other data; the admin console is intentionally not implemented as a separate native screen and remains website-only.

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
- External web links open outside the app.
- The Android admin panel is deliberately omitted; admin management remains on the website.

## Important integration checks
The native shell reuses the production website and therefore the same Supabase backend and records. Before publishing, test login/signup, Google OAuth return flow, camera/file evidence upload, location permission prompts, downloads, browser back navigation, and all AI/payment/reward workflows on physical devices. Some browser-based OAuth/payment providers restrict embedded WebViews; if Google sign-in does not return correctly, move that flow to Custom Tabs/deep-link handling before release. Push notifications are not enabled merely by declaring notification permission; a push provider and token registration must be configured first.
