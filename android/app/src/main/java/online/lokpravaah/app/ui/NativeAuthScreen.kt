package online.lokpravaah.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Native sign-in presentation. Authentication actions are intentionally injected;
 * connect them to the shared Supabase Auth implementation before making this the
 * production entry screen.
 */
@Composable
fun NativeAuthScreen(
    onSignIn: (email: String, password: String) -> Unit = { _, _ -> },
    onGoogleSignIn: () -> Unit = {},
    onCreateAccount: () -> Unit = {},
    isLoading: Boolean = false,
    errorMessage: String? = null,
    modifier: Modifier = Modifier
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LokPravaahScreenSurface {
        Column(
            modifier = modifier.fillMaxSize().background(LokPravaahColors.Ink).padding(horizontal = 24.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier.size(58.dp).background(LokPravaahColors.Mint, RoundedCornerShape(18.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text("L", color = LokPravaahColors.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(28.dp))
            Text("Welcome back", color = LokPravaahColors.TextPrimary, fontSize = 31.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("Sign in to follow your reports and make a difference in your community.", color = LokPravaahColors.TextSecondary, fontSize = 14.sp, lineHeight = 21.sp)
            Spacer(Modifier.height(26.dp))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Email address") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                colors = authFieldColors()
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    Text(
                        if (passwordVisible) "Hide" else "Show",
                        modifier = Modifier.padding(horizontal = 12.dp),
                        color = LokPravaahColors.Mint,
                        fontSize = 12.sp
                    )
                },
                shape = RoundedCornerShape(14.dp),
                colors = authFieldColors()
            )
            Spacer(Modifier.height(18.dp))

            if (errorMessage != null) {
                Text(errorMessage, color = LokPravaahColors.Danger, fontSize = 13.sp, lineHeight = 18.sp)
                Spacer(Modifier.height(12.dp))
            }

            Button(
                onClick = { onSignIn(email.trim(), password) },
                enabled = !isLoading && email.contains("@") && password.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(15.dp),
                colors = ButtonDefaults.buttonColors(containerColor = LokPravaahColors.Mint, contentColor = LokPravaahColors.Ink)
            ) {
                Text(if (isLoading) "Signing in…" else "Sign in", fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f).height(1.dp).background(LokPravaahColors.Border))
                Text("  OR  ", color = LokPravaahColors.TextSecondary, fontSize = 11.sp)
                Spacer(Modifier.weight(1f).height(1.dp).background(LokPravaahColors.Border))
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = onGoogleSignIn,
                enabled = !isLoading,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(15.dp),
                colors = ButtonDefaults.buttonColors(containerColor = LokPravaahColors.SurfaceRaised, contentColor = LokPravaahColors.TextPrimary)
            ) {
                Text("G   Continue with Google", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("New to LokPravaah?", color = LokPravaahColors.TextSecondary, fontSize = 13.sp)
                Text(
                    "  Create account",
                    color = LokPravaahColors.Mint,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(36.dp))
            Row(
                modifier = Modifier.fillMaxWidth().border(1.dp, LokPravaahColors.Border, RoundedCornerShape(14.dp)).padding(13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(Modifier.size(8.dp).background(LokPravaahColors.Success, CircleShape))
                Text("One account across the LokPravaah website and app.", color = LokPravaahColors.TextSecondary, fontSize = 11.sp, lineHeight = 16.sp)
            }
        }
    }
}

@Composable
private fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = LokPravaahColors.TextPrimary,
    unfocusedTextColor = LokPravaahColors.TextPrimary,
    focusedBorderColor = LokPravaahColors.Mint,
    unfocusedBorderColor = LokPravaahColors.Border,
    focusedLabelColor = LokPravaahColors.Mint,
    unfocusedLabelColor = LokPravaahColors.TextSecondary,
    cursorColor = LokPravaahColors.Mint
)
