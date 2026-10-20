package online.lokpravaah.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
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
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import java.net.URISyntaxException

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
        window.statusBarColor = android.graphics.Color.rgb(7, 17, 31)
        window.navigationBarColor = android.graphics.Color.rgb(7, 17, 31)
        setContent {
            MaterialTheme {
                var introDone by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    kotlinx.coroutines.delay(2600)
                    introDone = true
                    showIntro = false
                }
                BackHandler(enabled = !showIntro && webView?.canGoBack() == true) {
                    webView?.goBack()
                }
                Box(Modifier.fillMaxSize().background(Navy)) {
                    if (showIntro) {
                        IntroScreen()
                    } else {
                        AppWebScreen(
                            activity = this@MainActivity,
                            onWebView = { webView = it },
                            loading = pageLoading,
                            error = webError,
                            onRetry = { webError = false; pageLoading = true; webView?.reload() }
                        )
                    }
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    internal fun createConfiguredWebView(): WebView {
        return WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(android.graphics.Color.rgb(7, 17, 31))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
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
                        type = "*/*"
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

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        webView?.apply { stopLoading(); loadUrl("about:blank"); destroy() }
        webView = null
        super.onDestroy()
    }
}

@Composable
private fun IntroScreen() {
    val transition = rememberInfiniteTransition(label = "logoPulse")
    val pulse by transition.animateFloat(
        initialValue = 0.94f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(1300, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "pulse"
    )
    val orbit by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(5000, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "orbit"
    )
    Box(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF081426), Color(0xFF0B1D34), Color(0xFF07111F)))
        ),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(
                modifier = Modifier.size(124.dp).scale(pulse).background(
                    Brush.linearGradient(listOf(Blue, Teal)), RoundedCornerShape(34.dp)
                ),
                contentAlignment = Alignment.Center
            ) {
                Text("L", color = White, fontSize = 68.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(28.dp))
            Text("LokPravaah", color = White, fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.8).sp)
            Spacer(Modifier.height(8.dp))
            Text(
                "YOUR VOICE. YOUR CITY. YOUR IMPACT.",
                color = Color(0xFF9BB6D3), fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(36.dp))
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                color = Teal,
                strokeWidth = 2.dp,
                trackColor = Color(0xFF17304D)
            )
        }
        Text(
            "CITIZEN POWERED CHANGE",
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 38.dp).alpha(0.7f),
            color = Color(0xFF7F9AB8), fontSize = 10.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Medium
        )
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
            modifier = Modifier.fillMaxSize(),
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
