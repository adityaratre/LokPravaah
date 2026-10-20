package online.lokpravaah.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import online.lokpravaah.app.data.NativeAuthRepository
import online.lokpravaah.app.data.NativeSupabaseClientProvider
import kotlinx.coroutines.launch

private val AuthNavy = Color(0xFF06111F)
private val AuthMint = Color(0xFFB6F4D7)
private val AuthMuted = Color(0xFF9BB1C8)
private val AuthPanel = Color(0xFF0E1D30)
private val AuthLine = Color(0xFF2B4159)
private val AuthWhite = Color(0xFFF5F9FF)

@Composable
fun NativeCitizenGate(
    passwordRecoveryPending: Boolean = false,
    onPasswordRecoveryComplete: () -> Unit = {}
) {
    val client = NativeSupabaseClientProvider.client
    var authenticated by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(true) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }
    var createAccount by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var resetMode by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(client) {
        if (client == null) {
            checking = false
            message = "Secure sign-in is not configured in this build. Rebuild the app with the Supabase URL and public key configured."
            isError = true
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

    Surface(Modifier.fillMaxSize(), color = AuthNavy) {
        when {
            checking -> {
                Box(
                    Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).background(
                        Brush.verticalGradient(listOf(AuthNavy, Color(0xFF102840), AuthNavy))
                    ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(15.dp)) {
                        NativeWaveBrandMark(68.dp)
                        CircularProgressIndicator(color = AuthMint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                        Text("Restoring your secure session", color = AuthMuted, fontSize = 13.sp)
                    }
                }
            }
            passwordRecoveryPending && authenticated && client != null -> {
                NativePasswordRecoveryScreen(onComplete = onPasswordRecoveryComplete)
            }
            authenticated && client != null -> {
                val currentUserId = client.auth.currentUserOrNull()?.id.orEmpty()
                if (currentUserId.isBlank()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Session could not be restored. Please sign in again.", color = AuthWhite)
                    }
                } else {
                    NativeAppShell(client = client, userId = currentUserId)
                }
            }
            else -> {
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.verticalGradient(listOf(Color(0xFF071321), AuthNavy, Color(0xFF09192A)))
                    )
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        drawCircle(Color(0xFF1E7762).copy(alpha = 0.10f), radius = size.width * 0.55f, center = androidx.compose.ui.geometry.Offset(size.width * 0.92f, size.height * 0.14f))
                        drawCircle(Color(0xFF2C6DAB).copy(alpha = 0.08f), radius = size.width * 0.50f, center = androidx.compose.ui.geometry.Offset(size.width * 0.02f, size.height * 0.82f))
                    }
                    Column(
                        modifier = Modifier.fillMaxSize()
                            .windowInsetsPadding(WindowInsets.safeDrawing)
                            .imePadding()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 22.dp, vertical = 20.dp),
                        horizontalAlignment = Alignment.Start,
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            NativeWaveBrandMark(54.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("LokPravaah", color = AuthWhite, fontSize = 23.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp)
                                Text("CITIZEN IMPACT PLATFORM", color = AuthMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.65.sp)
                            }
                        }

                        Spacer(Modifier.height(28.dp))
                        AnimatedVisibility(visible = true, enter = fadeIn() + slideInVertically(initialOffsetY = { it / 10 })) {
                            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                Surface(color = Color(0xFF17332F), shape = RoundedCornerShape(100.dp)) {
                                    Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Surface(color = AuthMint, shape = CircleShape, modifier = Modifier.size(6.dp)) {}
                                        Text("YOUR CITY. YOUR VOICE.", color = AuthMint, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                                    }
                                }
                                Text(
                                    if (resetMode) "Recover your\naccount." else if (createAccount) "Be part of\nthe change." else "A better city\nstarts with you.",
                                    color = AuthWhite, fontSize = 34.sp, lineHeight = 37.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.7).sp
                                )
                                Text(
                                    if (resetMode) "We’ll send a secure password reset link to your email." else if (createAccount) "Create your citizen account and help your neighbourhood move forward." else "Sign in to report local issues, track progress and make your voice count.",
                                    color = AuthMuted, fontSize = 13.sp, lineHeight = 20.sp
                                )
                            }
                        }

                        Spacer(Modifier.height(24.dp))
                        Surface(
                            color = AuthPanel.copy(alpha = 0.96f),
                            shape = RoundedCornerShape(27.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF31465C)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(19.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                                Text(
                                    if (resetMode) "Password recovery" else if (createAccount) "Create your account" else "Welcome back",
                                    color = AuthWhite, fontSize = 22.sp, fontWeight = FontWeight.Bold
                                )
                                Text(
                                    if (resetMode) "Enter the email linked to your account." else if (createAccount) "Your existing LokPravaah account is used across web and app." else "Continue securely with your existing account.",
                                    color = AuthMuted, fontSize = 12.sp, lineHeight = 18.sp
                                )

                                OutlinedTextField(
                                    value = email,
                                    onValueChange = { email = it; message = "" },
                                    modifier = Modifier.fillMaxWidth(),
                                    label = { Text("Email address") },
                                    placeholder = { Text("you@example.com") },
                                    leadingIcon = { Icon(Icons.Outlined.Email, contentDescription = null, tint = AuthMuted) },
                                    singleLine = true,
                                    enabled = !busy,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = if (resetMode) ImeAction.Done else ImeAction.Next),
                                    shape = RoundedCornerShape(15.dp),
                                    colors = authFieldColors()
                                )

                                if (!resetMode) {
                                    OutlinedTextField(
                                        value = password,
                                        onValueChange = { password = it; message = "" },
                                        modifier = Modifier.fillMaxWidth(),
                                        label = { Text("Password") },
                                        placeholder = { Text("Enter your password") },
                                        leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null, tint = AuthMuted) },
                                        trailingIcon = {
                                            IconButton(onClick = { showPassword = !showPassword }, enabled = !busy) {
                                                Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, contentDescription = if (showPassword) "Hide password" else "Show password", tint = AuthMuted)
                                            }
                                        },
                                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                        singleLine = true,
                                        enabled = !busy,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                        shape = RoundedCornerShape(15.dp),
                                        colors = authFieldColors()
                                    )
                                }

                                if (!resetMode && !createAccount) {
                                    TextButton(onClick = { resetMode = true; message = ""; isError = false }, enabled = !busy, modifier = Modifier.align(Alignment.End)) {
                                        Text("Forgot password?", color = AuthMint, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                    }
                                }

                                Button(
                                    onClick = {
                                        busy = true
                                        message = ""
                                        isError = false
                                        scope.launch {
                                            try {
                                                val auth = NativeAuthRepository()
                                                when {
                                                    resetMode -> {
                                                        auth.requestPasswordReset(email)
                                                        message = "If the account exists, a password-reset email will arrive shortly. Check your inbox and spam folder."
                                                        isError = false
                                                    }
                                                    createAccount -> {
                                                        auth.createAccount(email, password)
                                                        message = "Your account request was received. Check your email if confirmation is required."
                                                        isError = false
                                                    }
                                                    else -> {
                                                        auth.signInWithEmail(email, password)
                                                        message = "Signed in. Loading your citizen workspace…"
                                                        isError = false
                                                    }
                                                }
                                            } catch (exception: Exception) {
                                                message = exception.message?.take(220) ?: "We couldn't complete that request. Please try again."
                                                isError = true
                                            } finally { busy = false }
                                        }
                                    },
                                    enabled = !busy && client != null && email.isNotBlank() && (resetMode || password.isNotEmpty()),
                                    modifier = Modifier.fillMaxWidth().height(54.dp),
                                    shape = RoundedCornerShape(16.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = AuthMint, contentColor = AuthNavy, disabledContainerColor = Color(0xFF315347), disabledContentColor = Color(0xFF8CA99C))
                                ) {
                                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = AuthNavy, strokeWidth = 2.dp)
                                    else {
                                        Text(if (resetMode) "Send reset link" else if (createAccount) "Create account" else "Sign in securely", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                        Spacer(Modifier.width(9.dp))
                                        Icon(Icons.Outlined.ArrowForward, contentDescription = null, modifier = Modifier.size(17.dp))
                                    }
                                }

                                if (message.isNotBlank()) {
                                    Surface(
                                        color = if (isError) Color(0xFF3A252E) else Color(0xFF16382E),
                                        shape = RoundedCornerShape(13.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                                            Icon(if (isError) Icons.Outlined.Lock else Icons.Outlined.CheckCircle, contentDescription = null, tint = if (isError) Color(0xFFFFAFB8) else AuthMint, modifier = Modifier.size(18.dp))
                                            Text(message, color = if (isError) Color(0xFFFFD7DC) else AuthMint, fontSize = 12.sp, lineHeight = 18.sp)
                                        }
                                    }
                                }

                                if (!resetMode) {
                                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        HorizontalDivider(Modifier.weight(1f), color = AuthLine)
                                        Text("OR", color = AuthMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                        HorizontalDivider(Modifier.weight(1f), color = AuthLine)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            busy = true; message = ""; isError = false
                                            scope.launch {
                                                try { NativeAuthRepository().signInWithGoogle() }
                                                catch (exception: Exception) { message = exception.message?.take(200) ?: "Google sign-in couldn't start."; isError = true }
                                                finally { busy = false }
                                            }
                                        },
                                        enabled = !busy && client != null,
                                        modifier = Modifier.fillMaxWidth().height(52.dp),
                                        shape = RoundedCornerShape(15.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = AuthWhite),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, AuthLine)
                                    ) {
                                        Text("G", color = AuthWhite, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
                                        Spacer(Modifier.width(10.dp))
                                        Text("Continue with Google", fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(12.dp))
                        TextButton(
                            onClick = {
                                resetMode = false
                                createAccount = !createAccount
                                message = ""
                                isError = false
                                showPassword = false
                            },
                            enabled = !busy && !resetMode,
                            modifier = Modifier.align(Alignment.CenterHorizontally)
                        ) {
                            Text(if (createAccount) "Already have an account? Sign in" else "New to LokPravaah? Create account", color = AuthMint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        if (resetMode) {
                            TextButton(onClick = { resetMode = false; message = ""; isError = false }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                                Text("Back to sign in", color = AuthMuted, fontSize = 12.sp)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Lock, contentDescription = null, tint = Color(0xFF63819B), modifier = Modifier.size(12.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Your account and reports remain on secure LokPravaah services.", color = Color(0xFF7893AC), fontSize = 9.sp, textAlign = TextAlign.Center)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativePasswordRecoveryScreen(onComplete: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Box(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()
            .background(Brush.verticalGradient(listOf(Color(0xFF071321), AuthNavy, Color(0xFF09192A)))),
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NativeWaveBrandMark(56.dp)
                Column {
                    Text("LokPravaah", color = AuthWhite, fontWeight = FontWeight.ExtraBold, fontSize = 23.sp)
                    Text("ACCOUNT SECURITY", color = AuthMuted, fontWeight = FontWeight.Bold, fontSize = 9.sp, letterSpacing = 1.5.sp)
                }
            }
            Spacer(Modifier.height(15.dp))
            Text("Create a new\npassword.", color = AuthWhite, fontSize = 32.sp, lineHeight = 36.sp, fontWeight = FontWeight.ExtraBold)
            Text("Choose a strong password to secure your LokPravaah account.", color = AuthMuted, fontSize = 13.sp, lineHeight = 19.sp)
            Spacer(Modifier.height(8.dp))
            Surface(color = AuthPanel, shape = RoundedCornerShape(23.dp), border = androidx.compose.foundation.BorderStroke(1.dp, AuthLine), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                    OutlinedTextField(
                        value = password, onValueChange = { password = it; message = "" },
                        modifier = Modifier.fillMaxWidth(), label = { Text("New password") },
                        leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null, tint = AuthMuted) },
                        trailingIcon = { TextButton(onClick = { showPassword = !showPassword }) { Text(if (showPassword) "HIDE" else "SHOW", color = AuthMint, fontSize = 10.sp) } },
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = authFieldColors(), shape = RoundedCornerShape(15.dp)
                    )
                    OutlinedTextField(
                        value = confirmPassword, onValueChange = { confirmPassword = it; message = "" },
                        modifier = Modifier.fillMaxWidth(), label = { Text("Confirm password") },
                        leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null, tint = AuthMuted) },
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = authFieldColors(), shape = RoundedCornerShape(15.dp)
                    )
                    Button(
                        onClick = {
                            when {
                                password.length < 8 -> { message = "Use a password with at least 8 characters."; isError = true }
                                password != confirmPassword -> { message = "The passwords do not match."; isError = true }
                                else -> {
                                    busy = true; message = ""; isError = false
                                    scope.launch {
                                        try {
                                            NativeAuthRepository().updatePassword(password)
                                            message = "Password updated. Opening your secure workspace…"
                                            isError = false
                                            kotlinx.coroutines.delay(900)
                                            onComplete()
                                        } catch (exception: Exception) {
                                            message = exception.message?.take(200) ?: "Password could not be updated. Reopen the recovery link and try again."
                                            isError = true
                                        } finally { busy = false }
                                    }
                                }
                            }
                        },
                        enabled = !busy && password.isNotBlank() && confirmPassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(15.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AuthMint, contentColor = AuthNavy)
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(19.dp), color = AuthNavy)
                        else Text("Update password securely", fontWeight = FontWeight.Bold)
                    }
                    if (message.isNotBlank()) {
                        Text(message, color = if (isError) Color(0xFFFFBAC2) else AuthMint, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                }
            }
            Text("The recovery session is handled by Supabase Auth. Your password is never saved in the app database.", color = AuthMuted, fontSize = 11.sp, lineHeight = 17.sp)
        }
    }
}

@Composable
private fun NativeWaveBrandMark(size: androidx.compose.ui.unit.Dp) {
    Surface(
        modifier = Modifier.size(size),
        color = AuthMint,
        shape = RoundedCornerShape(size * 0.29f),
        shadowElevation = 12.dp
    ) {
        Canvas(Modifier.fillMaxSize().padding(size * 0.18f)) {
            val canvasWidth = this.size.width
            val canvasHeight = this.size.height
            val stroke = Stroke(width = size.toPx() * 0.06f)
            for (index in 0..2) {
                val y = canvasHeight * (0.22f + index * 0.25f)
                val wave = Path().apply {
                    moveTo(canvasWidth * 0.04f, y)
                    cubicTo(canvasWidth * 0.18f, y - canvasHeight * 0.14f, canvasWidth * 0.32f, y - canvasHeight * 0.14f, canvasWidth * 0.46f, y)
                    cubicTo(canvasWidth * 0.61f, y + canvasHeight * 0.14f, canvasWidth * 0.76f, y + canvasHeight * 0.14f, canvasWidth * 0.96f, y)
                }
                drawPath(wave, Color(0xFF0B3B30), style = stroke)
            }
        }
    }
}

@Composable
private fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = AuthWhite,
    unfocusedTextColor = AuthWhite,
    disabledTextColor = AuthMuted,
    focusedContainerColor = Color(0xFF091827),
    unfocusedContainerColor = Color(0xFF091827),
    disabledContainerColor = Color(0xFF0A1A2A),
    focusedBorderColor = AuthMint,
    unfocusedBorderColor = AuthLine,
    disabledBorderColor = AuthLine,
    focusedLabelColor = AuthMint,
    unfocusedLabelColor = AuthMuted,
    focusedPlaceholderColor = Color(0xFF718AA2),
    unfocusedPlaceholderColor = Color(0xFF718AA2),
    cursorColor = AuthMint,
    focusedLeadingIconColor = AuthMint,
    unfocusedLeadingIconColor = AuthMuted
)
