package online.lokpravaah.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import online.lokpravaah.app.data.NativeAuthRepository
import online.lokpravaah.app.data.NativeSupabaseClientProvider
import kotlinx.coroutines.launch

private val AppNavy = Color(0xFF07111F)
private val AppMint = Color(0xFFB6F4D7)
private val AppMuted = Color(0xFF9BB6D3)

@Composable
fun NativeCitizenGate(onOpenWebsite: () -> Unit) {
    val client = NativeSupabaseClientProvider.client
    var authenticated by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(true) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var createAccount by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(client) {
        if (client == null) {
            checking = false
            message = "Native authentication is not configured. Continue on the website."
        } else {
            client.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> { authenticated = true; checking = false }
                    is SessionStatus.NotAuthenticated -> { authenticated = false; checking = false }
                    is SessionStatus.Initializing -> checking = true
                    else -> checking = false
                }
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = AppNavy) {
        if (checking) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                CircularProgressIndicator(color = AppMint)
                Spacer(Modifier.height(12.dp))
                Text("Restoring your secure session…", color = AppMuted)
            }
        } else if (authenticated && client != null) {
            val currentUserId = client.auth.currentUserOrNull()?.id.orEmpty()
            if (currentUserId.isBlank()) {
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("Your session could not be restored.", color = Color.White)
                    TextButton(onClick = { message = "Please sign in again." }) { Text("Continue", color = AppMint) }
                }
            } else {
                NativeReportsScreen(
                    client = client,
                    userId = currentUserId,
                    onOpenWebsite = onOpenWebsite
                )
            }
        } else {
            Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("LokPravaah", color = AppMint, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("A better city starts with your voice.", color = AppMuted)
                Spacer(Modifier.height(26.dp))
                Text(if (createAccount) "Create your account" else "Welcome back", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(16.dp))
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(16.dp))
                Button(onClick = {
                    busy = true
                    message = ""
                    scope.launch {
                        try {
                            val auth = NativeAuthRepository()
                            if (createAccount) {
                                auth.createAccount(email, password)
                                message = "Account request submitted. Check email if confirmation is required."
                            } else {
                                auth.signInWithEmail(email, password)
                                message = "Sign-in successful. Restoring session…"
                            }
                        } catch (e: Exception) { message = e.message?.take(180) ?: "Authentication failed." }
                        finally { busy = false }
                    }
                }, enabled = !busy && client != null, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = AppMint, contentColor = AppNavy)) {
                    if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = AppNavy)
                    else Text(if (createAccount) "Create account" else "Sign in", fontWeight = FontWeight.Bold)
                }
                TextButton(onClick = { createAccount = !createAccount; message = "" }) { Text(if (createAccount) "Already registered? Sign in" else "Create an account", color = AppMint) }
                TextButton(onClick = {
                    busy = true
                    scope.launch {
                        try { NativeAuthRepository().signInWithGoogle() }
                        catch (e: Exception) { message = e.message?.take(180) ?: "Google sign-in could not start." }
                        finally { busy = false }
                    }
                }, enabled = !busy && client != null) { Text("Continue with Google", color = Color.White) }
                if (message.isNotBlank()) Text(message, color = AppMuted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                TextButton(onClick = onOpenWebsite) { Text("Continue on website", color = AppMuted) }
            }
        }
    }
}
