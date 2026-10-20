package online.lokpravaah.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shared brand tokens for the native app. Keep aligned with the website palette. */
object LokPravaahColors {
    val Ink = Color(0xFF07111F)
    val Surface = Color(0xFF101D2B)
    val SurfaceRaised = Color(0xFF172738)
    val Mint = Color(0xFFB6F4D7)
    val MintDeep = Color(0xFF12372A)
    val TextPrimary = Color(0xFFF4F8F6)
    val TextSecondary = Color(0xFFA5B6B1)
    val Border = Color(0xFF293D4C)
    val Success = Color(0xFF68D6A7)
    val Warning = Color(0xFFF5C46A)
    val Danger = Color(0xFFFF8585)
}

@Composable
fun LokPravaahScreenSurface(content: @Composable () -> Unit) {
    Surface(color = LokPravaahColors.Ink, contentColor = LokPravaahColors.TextPrimary) {
        content()
    }
}

@Composable
fun NativeSectionHeading(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, color = LokPravaahColors.TextPrimary, fontSize = 21.sp, fontWeight = FontWeight.Bold)
        if (subtitle != null) {
            Text(subtitle, color = LokPravaahColors.TextSecondary, fontSize = 13.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
fun NativeMetricCard(
    label: String,
    value: String,
    supportingText: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .background(LokPravaahColors.Surface, RoundedCornerShape(20.dp))
            .border(1.dp, LokPravaahColors.Border, RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        Text(label, color = LokPravaahColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        Text(value, color = LokPravaahColors.Mint, fontSize = 27.sp, fontWeight = FontWeight.Bold)
        Text(supportingText, color = LokPravaahColors.TextSecondary, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

@Composable
fun NativeStatusPill(label: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .background(color.copy(alpha = 0.13f), CircleShape)
            .border(1.dp, color.copy(alpha = 0.38f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Spacer(Modifier.size(6.dp).background(color, CircleShape))
        Text(label, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}
