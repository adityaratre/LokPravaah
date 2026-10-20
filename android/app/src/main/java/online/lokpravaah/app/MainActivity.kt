package online.lokpravaah.app

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import io.github.jan.supabase.auth.handleDeeplinks
import online.lokpravaah.app.data.NativeSupabaseClientProvider
import online.lokpravaah.app.data.NativeSupabaseConfig
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

private val AppNavy = Color(0xFF06111F)
private val AppMint = Color(0xFFB6F4D7)
private val AppBlue = Color(0xFF7CB9FF)
private val AppWhite = Color(0xFFF5F9FF)
private val AppMuted = Color(0xFF9BB1C8)

class MainActivity : ComponentActivity() {
    private var showIntro by mutableStateOf(true)
    private var splashSoundEnabled by mutableStateOf(true)
    private var passwordRecoveryPending by mutableStateOf(false)
    private var startupAudioTrack: AudioTrack? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleNativeAuthCallback(intent)
        window.statusBarColor = android.graphics.Color.rgb(6, 17, 31)
        window.navigationBarColor = android.graphics.Color.rgb(6, 17, 31)
        window.decorView.systemUiVisibility = 0

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = AppMint,
                    onPrimary = AppNavy,
                    secondary = AppBlue,
                    background = AppNavy,
                    surface = Color(0xFF0E1D30),
                    onSurface = AppWhite,
                    outline = Color(0xFF526980)
                )
            ) {
                LaunchedEffect(Unit) {
                    kotlinx.coroutines.delay(180)
                    if (splashSoundEnabled) playStartupChime()
                    kotlinx.coroutines.delay(1540)
                    showIntro = false
                }
                Surface(Modifier.fillMaxSize(), color = AppNavy) {
                    if (showIntro) {
                        IntroScreen(
                            soundEnabled = splashSoundEnabled,
                            onToggleSound = { splashSoundEnabled = !splashSoundEnabled }
                        )
                    } else {
                        NativeCitizenGate(
                            passwordRecoveryPending = passwordRecoveryPending,
                            onPasswordRecoveryComplete = { passwordRecoveryPending = false }
                        )
                    }
                }
            }
        }
    }

    /**
     * A short, soft three-note chime synthesized locally. No network audio or sound file is
     * required; a failed audio device must never prevent the app from opening.
     */
    private fun playStartupChime() {
        try {
            val sampleRate = 22050
            val frameCount = sampleRate * 720 / 1000
            val notes = doubleArrayOf(523.25, 659.25, 783.99)
            val samples = ShortArray(frameCount) { index ->
                val t = index.toDouble() / sampleRate
                var value = 0.0
                notes.forEachIndexed { noteIndex, frequency ->
                    val localTime = t - noteIndex * 0.13
                    if (localTime >= 0.0) {
                        val attack = (localTime / 0.018).coerceIn(0.0, 1.0)
                        val decay = exp(-localTime * 4.6)
                        value += sin(2.0 * PI * frequency * localTime) * attack * decay * 0.24
                    }
                }
                val fade = (1.0 - t / 0.72).coerceIn(0.0, 1.0)
                (value * fade * Short.MAX_VALUE)
                    .coerceIn(Short.MIN_VALUE.toDouble(), Short.MAX_VALUE.toDouble())
                    .toInt().toShort()
            }
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val track = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(samples.size * 2)
                .build()
            track.write(samples, 0, samples.size)
            startupAudioTrack?.release()
            startupAudioTrack = track
            track.play()
        } catch (_: Exception) {
            // Audio is optional. Keep startup reliable on devices with unavailable audio output.
        }
    }

    private fun handleNativeAuthCallback(incoming: android.content.Intent?) {
        val callbackUri: Uri = incoming?.data ?: return
        if (!NativeSupabaseConfig.isConfigured ||
            callbackUri.scheme != "lokpravaah" ||
            callbackUri.host != "auth"
        ) return

        val callbackPayload = callbackUri.encodedQuery.orEmpty() + "&" + callbackUri.encodedFragment.orEmpty()
        if (callbackUri.getQueryParameter("type")?.equals("recovery", ignoreCase = true) == true ||
            callbackPayload.contains("type=recovery", ignoreCase = true)
        ) {
            passwordRecoveryPending = true
        }
        // Supabase's PKCE handler exchanges the code and restores the same account used by the website.
        // Never log the callback URI, authorization code or session tokens.
        NativeSupabaseClientProvider.client?.handleDeeplinks(incoming)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNativeAuthCallback(intent)
    }

    override fun onDestroy() {
        try {
            startupAudioTrack?.pause()
            startupAudioTrack?.flush()
            startupAudioTrack?.release()
        } catch (_: Exception) { }
        startupAudioTrack = null
        super.onDestroy()
    }
}

@Composable
private fun IntroScreen(soundEnabled: Boolean, onToggleSound: () -> Unit) {
    val progress = androidx.compose.runtime.remember { Animatable(0f) }
    val transition = rememberInfiniteTransition(label = "nativeBrandMotion")
    val pulse by transition.animateFloat(
        initialValue = 0.985f,
        targetValue = 1.035f,
        animationSpec = infiniteRepeatable(
            animation = tween(1250, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "logoPulse"
    )
    val orbit by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(8500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "particleOrbit"
    )

    LaunchedEffect(Unit) {
        progress.animateTo(1f, animationSpec = tween(1450, easing = FastOutSlowInEasing))
    }

    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                listOf(Color(0xFF030914), Color(0xFF081B2C), Color(0xFF092337), Color(0xFF06111F))
            )
        ),
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val minSide = size.minDimension
            val center = Offset(size.width / 2f, size.height * 0.405f)
            drawCircle(Color(0xFF2DD4BF).copy(alpha = 0.07f), radius = minSide * 0.36f, center = center, style = Stroke(width = 1.2.dp.toPx()))
            drawCircle(Color(0xFF7CB9FF).copy(alpha = 0.055f), radius = minSide * 0.43f, center = center, style = Stroke(width = 1.dp.toPx()))
            drawCircle(Color(0xFFB6F4D7).copy(alpha = 0.06f), radius = minSide * (0.30f + 0.008f * sin(orbit * PI.toFloat() / 180f)), center = center, style = Stroke(width = 2.dp.toPx()))

            // Small particles converge from a gentle orbit into the three-wave LokPravaah mark.
            val p = progress.value.coerceIn(0f, 1f)
            for (i in 0 until 78) {
                val row = i % 3
                val point = i / 3
                val xFraction = point / 25f
                val targetX = center.x + (xFraction - 0.5f) * minSide * 0.205f
                val wave = sin(xFraction * PI.toFloat() * 2f) * minSide * 0.019f
                val targetY = center.y + (row - 1) * minSide * 0.048f + wave
                val angle = i * 2.3999632f + orbit * PI.toFloat() / 180f * 0.18f
                val radius = minSide * (0.13f + (i % 5) * 0.035f)
                val startX = center.x + cos(angle) * radius
                val startY = center.y + sin(angle) * radius
                val travel = ((p - (i % 6) * 0.012f) / 0.88f).coerceIn(0f, 1f)
                val x = startX + (targetX - startX) * travel
                val y = startY + (targetY - startY) * travel
                val rowColor = when (row) {
                    0 -> AppMint
                    1 -> AppBlue
                    else -> Color(0xFF61D9BC)
                }
                val alpha = ((1f - travel) * 0.52f + (1f - p) * 0.22f).coerceIn(0.035f, 0.72f)
                drawCircle(
                    color = rowColor.copy(alpha = alpha),
                    radius = (1.15f + (i % 4) * 0.30f) * (0.75f + p * 0.25f),
                    center = Offset(x, y)
                )
            }
        }

        Column(
            modifier = Modifier.align(Alignment.Center).offset(y = (-19).dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier.size(146.dp).scale(pulse).background(
                    Brush.linearGradient(listOf(Color(0xFFD7FFEA), AppMint, Color(0xFF79DEB5))),
                    RoundedCornerShape(42.dp)
                ),
                contentAlignment = Alignment.Center
            ) {
                Canvas(Modifier.fillMaxSize().padding(29.dp)) {
                    val reveal = ((progress.value - 0.24f) / 0.76f).coerceIn(0f, 1f)
                    val stroke = Stroke(width = size.width * 0.075f)
                    for (index in 0..2) {
                        val y = size.height * (0.22f + index * 0.28f)
                        val wavePath = Path().apply {
                            moveTo(size.width * 0.04f, y)
                            cubicTo(
                                size.width * 0.19f, y - size.height * 0.14f,
                                size.width * 0.31f, y - size.height * 0.14f,
                                size.width * 0.46f, y
                            )
                            cubicTo(
                                size.width * 0.62f, y + size.height * 0.14f,
                                size.width * 0.78f, y + size.height * 0.14f,
                                size.width * 0.96f, y
                            )
                        }
                        drawPath(wavePath, Color(0xFF103D32).copy(alpha = reveal), style = stroke)
                    }
                }
            }
            Spacer(Modifier.height(27.dp))
            AnimatedVisibility(
                visible = progress.value > 0.15f,
                enter = fadeIn(tween(420)) + scaleIn(initialScale = 0.92f, animationSpec = tween(420))
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "LokPravaah",
                        color = AppWhite,
                        fontSize = 35.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = (-1.0).sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "YOUR VOICE. YOUR CITY. YOUR IMPACT.",
                        color = AppMuted,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.55.sp,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(20.dp))
                    Box(Modifier.size(width = 92.dp, height = 3.dp).background(Color(0xFF17334A), RoundedCornerShape(100.dp))) {
                        Box(
                            Modifier.fillMaxWidth(progress.value.coerceIn(0.03f, 1f)).height(3.dp)
                                .background(Brush.horizontalGradient(listOf(AppBlue, AppMint)), RoundedCornerShape(100.dp))
                        )
                    }
                }
            }
        }

        Column(
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 23.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            Text("CITIZEN POWERED CHANGE", color = Color(0xFF7893AC), fontSize = 9.sp, letterSpacing = 2.3.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onToggleSound) {
                Text(
                    if (soundEnabled) "♫  SOUND ON · TAP TO MUTE" else "♫  SOUND OFF · TAP TO ENABLE",
                    color = Color(0xFF9BB6D3),
                    fontSize = 9.sp,
                    letterSpacing = 0.7.sp
                )
            }
        }
    }
}