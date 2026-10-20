package online.lokpravaah.app.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.ExternalAuthAction
import io.github.jan.supabase.auth.FlowType

/**
 * Shared native Supabase client. This connects to the same project as the website;
 * it never creates a separate account system or app-specific data store.
 */
object NativeSupabaseClientProvider {
    val client: SupabaseClient? by lazy {
        if (!NativeSupabaseConfig.isConfigured) {
            null
        } else {
            createSupabaseClient(
                supabaseUrl = NativeSupabaseConfig.projectUrl,
                supabaseKey = NativeSupabaseConfig.publicKey
            ) {
                install(Auth) {
                    // These values must match the Android manifest and Supabase redirect allow-list.
                    scheme = "lokpravaah"
                    host = "auth"
                    flowType = FlowType.PKCE
                    defaultExternalAuthAction = ExternalAuthAction.CustomTabs()
                }
            }
        }
    }
}
