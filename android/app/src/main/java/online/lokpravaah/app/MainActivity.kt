package online.lokpravaah.app

import android.Manifest
import android.media.AudioManager
import android.media.ToneGenerator
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import online.lokpravaah.app.data.NativeSupabaseConfig
import online.lokpravaah.app.data.NativeSupabaseClientProvider
import io.github.jan.supabase.auth.handleDeeplinks
import java.net.URISyntaxException
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private const val HOME_URL = "https://lokpravaah.online/?mobileApp=1"
private const val APP_HOST = "lokpravaah.online"
private val Navy = Color(0xFF07111F)
private val Blue = Color(0xFF3B82F6)
private val Teal = Color(0xFF2DD4BF)
private val White = Color(0xFFF8FAFC)

class MainActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var fileChooserCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var pendingGeoOrigin: String? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var webError by mutableStateOf(false)
    private var pageLoading by mutableStateOf(true)
    private var showIntro by mutableStateOf(true)
    private var showWebsite by mutableStateOf(false)
    private var splashSoundEnabled by mutableStateOf(true)
    private var passwordRecoveryPending by mutableStateOf(false)
    private var startupTone: ToneGenerator? = null

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        val data = result.data
        val uris = if (result.resultCode == Activity.RESULT_OK && data != null) {
            data.clipData?.let { clip ->
                Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
            } ?: data.data?.let { arrayOf(it) }
        } else null
        callback?.onReceiveValue(uris)
    }

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        val granted = results[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            results[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        pendingGeoCallback?.invoke(pendingGeoOrigin, granted, false)
        pendingGeoCallback = null
        pendingGeoOrigin = null

        val request = pendingWebPermission
        if (request != null) {
            val cameraGranted = results[Manifest.permission.CAMERA] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            val resources = request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
            if (cameraGranted && resources.isNotEmpty()) request.grant(resources.toTypedArray()) else request.deny()
            pendingWebPermission = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleNativeAuthCallback(intent)
        window.statusBarColor = android.graphics.Color.rgb(7, 17, 31)
        window.navigationBarColor = android.graphics.Color.rgb(7, 17, 31)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFFB6F4D7),
                    onPrimary = Color(0xFF07111F),
                    secondary = Color(0xFF7CB9FF),
                    background = Color(0xFF06111F),
                    surface = Color(0xFF0E1D30),
                    onSurface = Color(0xFFF5F9FF),
                    outline = Color(0xFF526980)
                )
            ) {
                LaunchedEffect(Unit) {
                    kotlinx.coroutines.delay(380)
                    if (splashSoundEnabled) playStartupChime()
                    kotlinx.coroutines.delay(2400)
                    showIntro = false
                }
                BackHandler(enabled = !showIntro && showWebsite && webView?.canGoBack() != true) {
                    showWebsite = false
                    webView = null
                    webError = false
                }
                BackHandler(enabled = !showIntro && webView?.canGoBack() == true) {
                    webView?.goBack()
                }
                Box(Modifier.fillMaxSize().background(Navy)) {
                    if (showIntro) {
                        IntroScreen(soundEnabled = splashSoundEnabled, onToggleSound = { splashSoundEnabled = !splashSoundEnabled })
                    } else if (showWebsite) {
                        Column(
                            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).background(Navy)
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                androidx.compose.material3.IconButton(onClick = {
                                    showWebsite = false
                                    webView = null
                                    webError = false
                                }) {
                                    androidx.compose.material3.Icon(
                                        androidx.compose.material.icons.Icons.Outlined.ArrowBack,
                                        contentDescription = "Back to native app",
                                        tint = Color(0xFFB6F4D7)
                                    )
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text("LokPravaah", color = Color(0xFFF5F9FF), fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                    Text("Website tools · stays inside the app", color = Color(0xFF9BB1C8), fontSize = 10.sp)
                                }
                                androidx.compose.material3.TextButton(onClick = {
                                    showWebsite = false
                                    webView = null
                                    webError = false
                                }) { Text("Back to app", color = Color(0xFFB6F4D7), fontSize = 11.sp) }
                            }
                            AppWebScreen(
                                modifier = Modifier.weight(1f).fillMaxWidth(),
                                activity = this@MainActivity,
                                onWebView = { webView = it },
                                loading = pageLoading,
                                error = webError,
                                onRetry = { webError = false; pageLoading = true; webView?.reload() }
                            )
                        }
                    } else {
                        NativeCitizenGate(
                            onOpenWebsite = { showWebsite = true },
                            passwordRecoveryPending = passwordRecoveryPending,
                            onPasswordRecoveryComplete = { passwordRecoveryPending = false }
                        )
                    }
                }
            }
        }
    }

    private fun playStartupChime() {
        try {
            if (startupTone == null) startupTone = ToneGenerator(AudioManager.STREAM_MUSIC, 38)
            startupTone?.startTone(ToneGenerator.TONE_PROP_ACK, 260)
        } catch (_: Exception) {
            // Audio feedback is a progressive enhancement; it must never block app startup.
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    internal fun createConfiguredWebView(): WebView {
        return WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(android.graphics.Color.rgb(7, 17, 31))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Preserve session cookies during Supabase authentication redirects.
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.safeBrowsingEnabled = true
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && (uri.host == APP_HOST || uri.host?.endsWith(".$APP_HOST") == true)) return false
                    if (uri.scheme == "https" && uri.host?.endsWith(".supabase.co") == true) return false
                    if (uri.scheme == "http" || uri.scheme == "https") {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        return true
                    }
                    if (uri.scheme == "mailto" || uri.scheme == "tel") {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        return true
                    }
                    return true
                }
                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    pageLoading = true
                    webError = false
                }
                override fun onPageFinished(view: WebView, url: String) {
                    pageLoading = false
                    webError = false
                    // The native app is for citizens; hide web admin entry points in this shell.
                    // Server-side role checks remain authoritative on the website and database.
                    if (Uri.parse(url).host == APP_HOST) {
                        view.evaluateJavascript(
                            "(function(){" +
                                "document.querySelectorAll('.admin-sidebar-link,.admin-entry').forEach(function(e){e.style.display='none';});" +
                                "document.querySelectorAll('button').forEach(function(b){if(/admin console|moderation console/i.test(b.innerText||'')){b.style.display='none';}});" +
                                "})();",
                            null
                        )
                    }
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        pageLoading = false
                        webError = true
                    }
                }
                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    handler.cancel()
                    pageLoading = false
                    webError = true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: android.webkit.ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = filePathCallback
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        val acceptedTypes = fileChooserParams.acceptTypes
                            .flatMap { it.split(",") }
                            .map { it.trim() }
                            .filter { it.isNotEmpty() && it.contains("/") }
                            .distinct()
                        type = if (acceptedTypes.size == 1) acceptedTypes.first() else "*/*"
                        if (acceptedTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, acceptedTypes.toTypedArray())
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    return try {
                        filePicker.launch(intent)
                        true
                    } catch (_: Exception) {
                        fileChooserCallback?.onReceiveValue(null)
                        fileChooserCallback = null
                        false
                    }
                }
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        callback.invoke(origin, true, false)
                    } else {
                        pendingGeoOrigin = origin
                        pendingGeoCallback = callback
                        permissionRequest.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
                    }
                }
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val cameraRequested = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                        if (!cameraRequested) {
                            request.deny()
                        } else if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }.toTypedArray())
                        } else {
                            pendingWebPermission = request
                            permissionRequest.launch(arrayOf(Manifest.permission.CAMERA))
                        }
                    }
                }
            }
            setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                } catch (_: Exception) {
                    // A missing handler should not crash the app.
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNativeAuthCallback(intent)
    }

    private fun handleNativeAuthCallback(intent: Intent?) {
        val callbackUri = intent?.data ?: return
        if (!NativeSupabaseConfig.isConfigured || callbackUri.scheme != "lokpravaah" || callbackUri.host != "auth") return
        val callbackPayload = (callbackUri.encodedQuery.orEmpty() + "&" + callbackUri.encodedFragment.orEmpty())
        if (callbackUri.getQueryParameter("type")?.equals("recovery", ignoreCase = true) == true ||
            callbackPayload.contains("type=recovery", ignoreCase = true)) {
            passwordRecoveryPending = true
        }
        // The SDK validates and exchanges the PKCE callback; do not log the callback URL or tokens.
        NativeSupabaseClientProvider.client?.handleDeeplinks(intent)
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        webView?.apply { stopLoading(); loadUrl("about:blank"); destroy() }
        webView = null
        try { startupTone?.release() } catch (_: Exception) { }
        startupTone = null
        super.onDestroy()
    }
}

@Composable
private fun IntroScreen(soundEnabled: Boolean, onToggleSound: () -> Unit) {
    val progress = remember { Animatable(0f) }
    val pulseTransition = rememberInfiniteTransition(label = "splashPulse")
    val pulse by pulseTransition.animateFloat(
        initialValue = 0.98f,
        targetValue = 1.035f,
        animationSpec = infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "brandPulse"
    )
    val orbit by pulseTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(9000, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "particleOrbit"
    )
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(100)
        progress.animateTo(1f, tween(1850, easing = FastOutSlowInEasing))
    }

    Box(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                listOf(Color(0xFF06101E), Color(0xFF0A1D31), Color(0xFF0A1727), Color(0xFF06111F))
            )
        ),
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val cx = size.width / 2f
            val cy = size.height / 2f - size.height * 0.055f
            val radius = size.minDimension * 0.34f
            for (i in 0 until 92) {
                val angle = i * 2.3999632f + orbit * (PI.toFloat() / 180f) * 0.12f
                val sx = cx + cos(angle) * radius
                val sy = cy + sin(angle) * radius
                val slot = i % 31
                val row = i % 3
                val tx = size.width * (0.36f + (slot / 30f) * 0.28f)
                val wave = sin((tx / size.width) * PI.toFloat() * 3.1f + row * 0.85f)
                val ty = cy + (row - 1) * size.minDimension * 0.105f + wave * size.minDimension * 0.035f
                val x = sx + (tx - sx) * progress.value
                val y = sy + (ty - sy) * progress.value
                val colour = when (row) {
                    0 -> Color(0xFFB6F4D7)
                    1 -> Color(0xFF7CB9FF)
                    else -> Color(0xFF64DBC2)
                }
                val alpha = (0.18f + progress.value * 0.72f).coerceIn(0f, 0.9f)
                drawCircle(
                    color = colour.copy(alpha = alpha),
                    radius = (1.4f + (i % 4) * 0.38f) * (0.7f + progress.value * 0.3f),
                    center = Offset(x, y)
                )
            }
            val drawWave = ((progress.value - 0.42f) / 0.58f).coerceIn(0f, 1f)
            val stroke = Stroke(width = size.minDimension * 0.0085f)
            for (index in 0..2) {
                val y = cy + size.minDimension * (index - 1) * 0.105f
                val wavePath = Path().apply {
                    moveTo(cx - size.minDimension * 0.105f, y)
                    cubicTo(
                        cx - size.minDimension * 0.055f, y - size.minDimension * 0.055f,
                        cx - size.minDimension * 0.025f, y - size.minDimension * 0.055f,
                        cx, y
                    )
                    cubicTo(
                        cx + size.minDimension * 0.055f, y + size.minDimension * 0.055f,
                        cx + size.minDimension * 0.075f, y + size.minDimension * 0.055f,
                        cx + size.minDimension * 0.105f, y
                    )
                }
                drawPath(wavePath, Color(0xFFD9FFF0).copy(alpha = drawWave), style = stroke)
            }
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(
                modifier = Modifier.size(164.dp).scale(pulse).background(
                    Brush.linearGradient(listOf(Color(0xFFB6F4D7).copy(alpha = 0.92f), Color(0xFF69D9BC).copy(alpha = 0.72f))),
                    RoundedCornerShape(42.dp)
                ),
                contentAlignment = Alignment.Center
            ) {
                Canvas(Modifier.size(112.dp)) {
                    val alpha = ((progress.value - 0.25f) / 0.75f).coerceIn(0f, 1f)
                    val waveStroke = Stroke(width = size.width * 0.075f)
                    for (index in 0..2) {
                        val y = size.height * (0.22f + index * 0.25f)
                        val wave = Path().apply {
                            moveTo(size.width * 0.08f, y)
                            cubicTo(size.width * 0.22f, y - size.height * 0.14f, size.width * 0.31f, y - size.height * 0.14f, size.width * 0.45f, y)
                            cubicTo(size.width * 0.59f, y + size.height * 0.14f, size.width * 0.70f, y + size.height * 0.14f, size.width * 0.92f, y)
                        }
                        drawPath(wave, Color(0xFF103D32).copy(alpha = alpha), style = waveStroke)
                    }
                }
            }
            Spacer(Modifier.height(30.dp))
            AnimatedVisibility(
                visible = progress.value > 0.2f,
                enter = fadeIn(tween(420)) + scaleIn(initialScale = 0.92f, animationSpec = tween(420))
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("LokPravaah", color = Color(0xFFF7FBFF), fontSize = 35.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.1).sp)
                    Spacer(Modifier.height(9.dp))
                    Text(
                        "YOUR VOICE. YOUR CITY. YOUR IMPACT.",
                        color = Color(0xFFA7C0D9), fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        letterSpacing = 1.8.sp, textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(22.dp))
                    Box(Modifier.width(100.dp).height(3.dp).background(Color(0xFF1A344B), RoundedCornerShape(100.dp))) {
                        Box(
                            Modifier.fillMaxWidth(progress.value.coerceIn(0.08f, 1f)).fillMaxHeight()
                                .background(Brush.horizontalGradient(listOf(Color(0xFF7CB9FF), Color(0xFFB6F4D7))), RoundedCornerShape(100.dp))
                        )
                    }
                }
            }
        }

        Column(
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("CITIZEN POWERED CHANGE", color = Color(0xFF7893AC), fontSize = 9.sp, letterSpacing = 2.5.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onToggleSound) {
                Text(
                    if (soundEnabled) "♫  STARTUP SOUND ON · TAP TO MUTE" else "♫  STARTUP SOUND OFF · TAP TO ENABLE",
                    color = Color(0xFF9BB6D3), fontSize = 9.sp, letterSpacing = 0.8.sp
                )
            }
        }
    }
}

@Composable
private fun AppWebScreen(
    activity: MainActivity,
    onWebView: (WebView) -> Unit,
    loading: Boolean,
    error: Boolean,
    onRetry: () -> Unit
) {
    Box(Modifier.fillMaxSize().background(Navy)) {
        AndroidView(
            modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
            factory = { context ->
                activity.createConfiguredWebView().also {
                    onWebView(it)
                    it.loadUrl(HOME_URL)
                }
            },
            update = { onWebView(it) }
        )
        if (loading && !error) {
            Box(Modifier.fillMaxSize().background(Navy.copy(alpha = 0.20f)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Teal, strokeWidth = 3.dp)
            }
        }
        if (error) {
            Column(
                modifier = Modifier.fillMaxSize().background(Navy).padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("You're offline or the page couldn't load", color = White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Spacer(Modifier.height(10.dp))
                Text("Check your connection and try again. Your account and data stay on LokPravaah's secure service.", color = Color(0xFFAAC0D8), textAlign = TextAlign.Center)
                Spacer(Modifier.height(24.dp))
                Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = Blue)) {
                    Text("Try again", color = White)
                }
            }
        }
    }
}
