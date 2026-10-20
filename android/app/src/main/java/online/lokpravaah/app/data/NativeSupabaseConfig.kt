package online.lokpravaah.app.data

import online.lokpravaah.app.BuildConfig

/**
 * Public client configuration only. The anon/publishable key is safe for clients
 * when database tables and functions enforce correct Supabase RLS policies.
 * Service-role and provider-secret keys must never be packaged in the APK.
 */
object NativeSupabaseConfig {
    val projectUrl: String = BuildConfig.SUPABASE_URL.trimEnd('/')
    val publicKey: String = BuildConfig.SUPABASE_ANON_KEY

    val isConfigured: Boolean
        get() = projectUrl.startsWith("https://") &&
            projectUrl.endsWith(".supabase.co") &&
            publicKey.isNotBlank() &&
            !publicKey.contains("YOUR_", ignoreCase = true)

    fun requireConfigured() {
        check(isConfigured) {
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in the Android build environment."
        }
    }
}
