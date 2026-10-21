package online.lokpravaah.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

private const val ORIGINAL_DONATION_PAGE = "https://lokpravaah.online/donate"

/**
 * Uses the production donation page only for checkout so Android invokes the exact original
 * bundled Youpi SDK/modal, manual UTR/receipt claim, and under-review flow instead of a
 * second native UPI implementation. The rest of the citizen app remains native Compose.
 * Guest donations are supported by the website flow; no web login is required here.
 */
@Composable
fun NativeDonationWebCheckoutScreen() {
    val context = LocalContext.current
    var progress by remember { mutableIntStateOf(0) }
    var loadError by remember { mutableStateOf(false) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            webViewRef?.apply {
                stopLoading()
                webChromeClient = null
                webViewClient = WebViewClient()
                removeAllViews()
                destroy()
            }
            webViewRef = null
        }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFF06111F)), verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Surface(color = Color(0xFF0E1D30), shape = RoundedCornerShape(bottomStart = 18.dp, bottomEnd = 18.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Support LokPravaah", color = Color(0xFFB6F4D7), fontSize = 19.sp)
                Text("Secure checkout powered by the original Youpi payment flow", color = Color(0xFF9BB1C8), fontSize = 11.sp)
            }
        }
        if (progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth(), color = Color(0xFFB6F4D7))
        Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        webViewRef = this
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = false
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        settings.setSupportMultipleWindows(false)
                        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        settings.safeBrowsingEnabled = true
                        settings.cacheMode = WebSettings.LOAD_DEFAULT
                        WebView.setWebContentsDebuggingEnabled(false)
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                progress = newProgress
                                if (newProgress >= 100) loadError = false
                            }
                        }
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                loadError = false
                                progress = 5
                            }
                            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                                if (request?.isForMainFrame == true) loadError = true
                            }
                            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                                handler?.cancel()
                                loadError = true
                            }
                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val uri = request?.url ?: return true
                                val scheme = uri.scheme.orEmpty().lowercase()
                                if (scheme == "http" || scheme == "https") return false
                                if (scheme == "upi" || scheme == "intent" || scheme == "phonepe" || scheme == "tez" || scheme == "paytmmp") {
                                    try {
                                        val intent = if (scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                                            else Intent(Intent.ACTION_VIEW, uri)
                                        context.startActivity(Intent.createChooser(intent, "Continue payment"))
                                    } catch (_: Exception) {
                                        loadError = true
                                    }
                                    return true
                                }
                                return true
                            }
                        }
                        loadUrl(ORIGINAL_DONATION_PAGE)
                    }
                }
            )
            if (progress < 100 && !loadError) {
                CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color(0xFFB6F4D7))
            }
            if (loadError) {
                Surface(color = Color(0xFF11263B), shape = RoundedCornerShape(18.dp), modifier = Modifier.align(Alignment.Center).padding(20.dp)) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Donation page couldn't load", color = Color.White, fontSize = 16.sp)
                        Text("Check your connection, then reload the original secure checkout.", color = Color(0xFF9BB1C8), fontSize = 12.sp)
                        androidx.compose.material3.Button(onClick = {
                            loadError = false
                            progress = 0
                            webViewRef?.loadUrl(ORIGINAL_DONATION_PAGE)
                        }) { Text("Retry") }
                    }
                }
            }
        }
    }
}