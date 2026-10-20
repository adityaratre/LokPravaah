package online.lokpravaah.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import io.github.jan.supabase.postgrest.from
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    var reports by remember { mutableStateOf<List<String>>(emptyList()) }
    var reportsLoading by remember { mutableStateOf(false) }
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
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("LokPravaah", color = AppMint, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Text("Your voice. Your city. Your impact.", color = AppMuted)
                Text("Citizen Home", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Text("Your account stays connected to the existing LokPravaah backend.", color = AppMuted)
                Button(onClick = {
                    reportsLoading = true
                    message = ""
                    scope.launch {
                        try {
                            val userId = client.auth.currentUserOrNull()?.id ?: error("Session expired. Sign in again.")
                            val result = client.from("reports").select {
                                filter { eq("reporter_id", userId) }
                            }
                            reports = Json.parseToJsonElement(result.data).jsonArray.map { row ->
                                val obj = row.jsonObject
                                val title = obj["title"]?.jsonPrimitive?.content ?: "Untitled report"
                                val status = (obj["status"]?.jsonPrimitive?.content ?: "submitted").replace('_', ' ')
                                val code = obj["public_code"]?.jsonPrimitive?.content.orEmpty()
                                title + "\\n" + status.replaceFirstChar { it.uppercase() } + if (code.isNotBlank()) " · " + code else ""
                            }
                            if (reports.isEmpty()) message = "No reports found for this account yet."
                        } catch (e: Exception) { message = e.message?.take(180) ?: "Couldn't load reports." }
                        finally { reportsLoading = false }
                    }
                }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = AppMint, contentColor = AppNavy)) { Text("Load my reports") }
                if (reportsLoading) CircularProgressIndicator(color = AppMint)
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(reports) { report ->
                        Surface(color = Color(0xFF102239), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                            Text(report, color = Color.White, modifier = Modifier.padding(14.dp), lineHeight = 21.sp)
                        }
                    }
                }
                Button(onClick = onOpenWebsite, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A3048))) { Text("Open full LokPravaah website", color = Color.White) }
                OutlinedButton(onClick = {
                    busy = true
                    scope.launch {
                        try { NativeAuthRepository().signOut(); message = "Signed out." }
                        catch (e: Exception) { message = e.message ?: "Sign-out failed." }
                        finally { busy = false }
                    }
                }, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "Signing out…" else "Sign out", color = Color.White) }
                if (message.isNotBlank()) Text(message, color = AppMuted)
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
