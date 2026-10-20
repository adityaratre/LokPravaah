package online.lokpravaah.app.data

import online.lokpravaah.app.BuildConfig

/**
 * Client-safe Supabase configuration. Only the publishable/anon key belongs in an
 * Android package; service-role keys and provider secrets must remain server-side.
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
