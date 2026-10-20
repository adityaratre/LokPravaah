package online.lokpravaah.app.data

import android.content.Intent
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.Email

/**
 * Native auth operations use the existing Supabase Auth project and identities.
 * No privileged keys are used here; authorization is enforced by Supabase/RLS.
 */
class NativeAuthRepository(
    private val supabase: SupabaseClient = requireNotNull(NativeSupabaseClientProvider.client) {
        "Native Supabase auth is unavailable. Check the Android build configuration."
    }
) {
    suspend fun signInWithEmail(email: String, password: String) {
        requireValidCredentials(email, password)
        supabase.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun createAccount(email: String, password: String) {
        requireValidCredentials(email, password)
        require(password.length >= 8) { "Use a password with at least 8 characters." }
        supabase.auth.signUpWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        // If email confirmation is enabled, the caller should tell the user to check email.
        // The repository does not assume that registration automatically authenticates the user.
    }

    suspend fun requestPasswordReset(email: String) {
        requireValidEmail(email)
        supabase.auth.resetPasswordForEmail(email.trim())
    }

    suspend fun updatePassword(password: String) {
        require(password.length >= 8) { "Use a password with at least 8 characters." }
        supabase.auth.updateUser {
            this.password = password
        }
    }

    suspend fun signInWithGoogle() {
        supabase.auth.signInWith(Google)
    }

    suspend fun signOut() {
        supabase.auth.signOut()
    }

    fun handleAuthDeepLink(intent: Intent) {
        supabase.handleDeeplinks(intent)
    }

    private fun requireValidCredentials(email: String, password: String) {
        requireValidEmail(email)
        require(password.isNotEmpty()) { "Enter your password." }
    }

    private fun requireValidEmail(email: String) {
        require(email.trim().matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))) {
            "Enter a valid email address."
        }
    }
}
