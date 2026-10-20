package online.lokpravaah.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private enum class NativeTab(val title: String, val symbol: String) {
    HOME("Home", "⌂"),
    REPORTS("Reports", "▤"),
    COMMUNITY("Community", "◎"),
    REWARDS("Rewards", "✦"),
    PROFILE("Profile", "◉")
}

/**
 * Native citizen app shell. It deliberately avoids fabricated account metrics:
 * live Supabase repositories and auth must be connected before real values render.
 * Kept separate from MainActivity until that integration is tested.
 */
@Composable
fun NativeHomeScreen(
    onReportIssue: () -> Unit = {},
    onOpenSignIn: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var selectedTab by remember { mutableStateOf(NativeTab.HOME) }

    LokPravaahScreenSurface {
        Column(modifier = modifier.fillMaxSize().background(LokPravaahColors.Ink)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 18.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier.size(42.dp).background(LokPravaahColors.Mint, RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text("L", color = LokPravaahColors.Ink, fontSize = 25.sp, fontWeight = FontWeight.Black)
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("LokPravaah", color = LokPravaahColors.TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text("People. Problems. Progress.", color = LokPravaahColors.TextSecondary, fontSize = 11.sp)
                }
                Box(
                    modifier = Modifier.size(42.dp)
                        .border(1.dp, LokPravaahColors.Border, CircleShape)
                        .background(LokPravaahColors.Surface, CircleShape)
                        .clickable { selectedTab = NativeTab.PROFILE },
                    contentAlignment = Alignment.Center
                ) {
                    Text("◉", color = LokPravaahColors.Mint, fontSize = 19.sp)
                }
            }

            Divider(color = LokPravaahColors.Border.copy(alpha = 0.65f))

            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when (selectedTab) {
                    NativeTab.HOME -> HomeOverview(onReportIssue, onOpenSignIn)
                    NativeTab.REPORTS -> NativePlaceholderPage(
                        eyebrow = "YOUR CIVIC IMPACT",
                        title = "My reports",
                        description = "Your submitted issues, evidence and status updates will appear here after secure sign-in.",
                        action = "Sign in to continue",
                        onAction = onOpenSignIn
                    )
                    NativeTab.COMMUNITY -> NativePlaceholderPage(
                        eyebrow = "LOCAL VOICES",
                        title = "Community",
                        description = "Community discussions and local updates will be connected to the existing LokPravaah service."
                    )
                    NativeTab.REWARDS -> NativePlaceholderPage(
                        eyebrow = "IMPACT, NOT JUST POINTS",
                        title = "Rewards",
                        description = "Your points and leaderboard position must come from the same source as the website—never a separate app-only balance.",
                        action = "Sign in to view rewards",
                        onAction = onOpenSignIn
                    )
                    NativeTab.PROFILE -> NativePlaceholderPage(
                        eyebrow = "YOUR ACCOUNT",
                        title = "Welcome to LokPravaah",
                        description = "Sign-in and profile data will use the existing shared Supabase identity.",
                        action = "Continue with account",
                        onAction = onOpenSignIn
                    )
                }
            }

            NativeBottomBar(selectedTab = selectedTab, onSelect = { selectedTab = it })
        }
    }
}

@Composable
private fun HomeOverview(onReportIssue: () -> Unit, onOpenSignIn: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 22.dp, end = 22.dp, top = 22.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NativeStatusPill("CITIZEN PLATFORM", LokPravaahColors.Success)
                Text("Make your area\nbetter, together.", color = LokPravaahColors.TextPrimary, fontSize = 32.sp, lineHeight = 37.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Report civic issues, follow progress and help your community move forward.",
                    color = LokPravaahColors.TextSecondary, fontSize = 14.sp, lineHeight = 21.sp
                )
            }
        }
        item {
            Column(
                modifier = Modifier.fillMaxWidth()
                    .background(Brush.linearGradient(listOf(LokPravaahColors.SurfaceRaised, LokPravaahColors.Surface)), RoundedCornerShape(24.dp))
                    .border(1.dp, LokPravaahColors.Border, RoundedCornerShape(24.dp))
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(13.dp)
            ) {
                Text("YOUR VOICE MATTERS", color = LokPravaahColors.Mint, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                Text("See a problem?\nHelp get it solved.", color = LokPravaahColors.TextPrimary, fontSize = 23.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
                Text("Share an issue with the right details so it can be tracked transparently.", color = LokPravaahColors.TextSecondary, fontSize = 13.sp, lineHeight = 19.sp)
                Button(
                    onClick = onReportIssue,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = LokPravaahColors.Mint, contentColor = LokPravaahColors.Ink)
                ) {
                    Text("＋  Report an issue", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        item {
            NativeSectionHeading("Your impact", "Live account stats appear after secure account integration.")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NativeMetricCard("Reports", "—", "Your submissions", Modifier.weight(1f))
                NativeMetricCard("Resolved", "—", "Issues closed", Modifier.weight(1f))
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NativeMetricCard("Impact points", "—", "Shared reward balance", Modifier.weight(1f))
                NativeMetricCard("Rank", "—", "Official leaderboard", Modifier.weight(1f))
            }
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth()
                    .background(LokPravaahColors.MintDeep, RoundedCornerShape(18.dp))
                    .border(1.dp, LokPravaahColors.Success.copy(alpha = 0.25f), RoundedCornerShape(18.dp))
                    .clickable(onClick = onOpenSignIn)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("Already part of the community?", color = LokPravaahColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("Sign in to access your existing reports and rewards.", color = LokPravaahColors.TextSecondary, fontSize = 12.sp, lineHeight = 17.sp)
                }
                Text("→", color = LokPravaahColors.Mint, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun NativePlaceholderPage(
    eyebrow: String,
    title: String,
    description: String,
    action: String? = null,
    onAction: () -> Unit = {}
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        NativeStatusPill(eyebrow, LokPravaahColors.Mint)
        Text(title, color = LokPravaahColors.TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text(description, color = LokPravaahColors.TextSecondary, fontSize = 15.sp, lineHeight = 23.sp)
        if (action != null) {
            Button(
                onClick = onAction,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = LokPravaahColors.Mint, contentColor = LokPravaahColors.Ink)
            ) {
                Text(action, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun NativeBottomBar(selectedTab: NativeTab, onSelect: (NativeTab) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .background(LokPravaahColors.Surface)
            .border(1.dp, LokPravaahColors.Border)
            .padding(horizontal = 5.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        NativeTab.entries.forEach { tab ->
            val selected = tab == selectedTab
            Column(
                modifier = Modifier.weight(1f).clickable { onSelect(tab) }.padding(vertical = 5.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(tab.symbol, color = if (selected) LokPravaahColors.Mint else LokPravaahColors.TextSecondary, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                Text(
                    tab.title,
                    color = if (selected) LokPravaahColors.Mint else LokPravaahColors.TextSecondary,
                    fontSize = 10.sp,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Clip
                )
                if (selected) Spacer(Modifier.width(18.dp).height(2.dp).background(LokPravaahColors.Mint, CircleShape))
                else Spacer(Modifier.height(2.dp))
            }
        }
    }
}
