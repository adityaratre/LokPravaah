package online.lokpravaah.app

import android.content.ContentResolver
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.ReportProblem
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.SouthEast
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import online.lokpravaah.app.data.NativeReport
import online.lokpravaah.app.data.NativeReportsRepository
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ShellNavy = Color(0xFF06111F)
private val ShellSurface = Color(0xFF0E1D30)
private val ShellCard = Color(0xFF11263B)
private val ShellMint = Color(0xFFB6F4D7)
private val ShellText = Color(0xFFF5F9FF)
private val ShellMuted = Color(0xFF9BB1C8)
private val ShellLine = Color(0xFF263E56)
private val ShellBlue = Color(0xFF7CB9FF)
private val ShellAmber = Color(0xFFF8D58B)
private val ShellRose = Color(0xFFFFA9B2)

private enum class CitizenTab(val label: String) {
    HOME("Home"), REPORTS("Reports"), REWARDS("Rewards"), COMMUNITY("Community"), PROFILE("Profile")
}

@Composable
fun NativeAppShell(client: SupabaseClient, userId: String, onOpenWebsite: () -> Unit) {
    var selectedTab by remember { mutableStateOf(CitizenTab.HOME) }
    var showBottomNav by remember { mutableStateOf(true) }
    BackHandler(enabled = selectedTab != CitizenTab.HOME) { selectedTab = CitizenTab.HOME; showBottomNav = true }

    Surface(
        modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding(),
        color = ShellNavy
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (selectedTab) {
                    CitizenTab.HOME -> NativeHomeScreen(
                        client = client, userId = userId,
                        onOpenReports = { selectedTab = CitizenTab.REPORTS },
                        onOpenRewards = { selectedTab = CitizenTab.REWARDS },
                        onOpenCommunity = { selectedTab = CitizenTab.COMMUNITY },
                        onOpenWebsite = onOpenWebsite
                    )
                    CitizenTab.REPORTS -> NativeReportsScreen(
                        client = client, userId = userId, onOpenWebsite = onOpenWebsite,
                        onContentDepthChanged = { showBottomNav = !it }
                    )
                    CitizenTab.REWARDS -> NativeRewardsScreen(client, userId)
                    CitizenTab.COMMUNITY -> NativeCommunityScreen(client, userId)
                    CitizenTab.PROFILE -> NativeProfileScreen(
                        client, userId, onOpenWebsite = onOpenWebsite,
                        onSignedOut = { selectedTab = CitizenTab.HOME }
                    )
                }
            }
            if (showBottomNav) {
                NativeBottomNavigation(selectedTab = selectedTab, onSelect = {
                    selectedTab = it
                    showBottomNav = true
                })
            }
        }
    }
}

@Composable
private fun NativeBottomNavigation(selectedTab: CitizenTab, onSelect: (CitizenTab) -> Unit) {
    NavigationBar(
        modifier = Modifier.fillMaxWidth(),
        containerColor = Color(0xFF091726),
        contentColor = ShellMuted,
        tonalElevation = 0.dp
    ) {
        val items = listOf(
            CitizenTab.HOME to Icons.Outlined.Home,
            CitizenTab.REPORTS to Icons.Outlined.ReceiptLong,
            CitizenTab.REWARDS to Icons.Outlined.AccountBalanceWallet,
            CitizenTab.COMMUNITY to Icons.Outlined.Forum,
            CitizenTab.PROFILE to Icons.Outlined.Person
        )
        items.forEach { (tab, image) ->
            val selected = tab == selectedTab
            val scale by animateFloatAsState(if (selected) 1.08f else 1f, animationSpec = tween(180), label = "navScale")
            NavigationBarItem(
                selected = selected,
                onClick = { onSelect(tab) },
                icon = { Icon(image, contentDescription = tab.label, modifier = Modifier.scale(scale)) },
                label = { Text(tab.label, fontSize = 10.sp, maxLines = 1) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = ShellNavy,
                    selectedTextColor = ShellMint,
                    indicatorColor = ShellMint,
                    unselectedIconColor = ShellMuted,
                    unselectedTextColor = ShellMuted
                )
            )
        }
    }
}

@Composable
private fun NativeHomeScreen(
    client: SupabaseClient,
    userId: String,
    onOpenReports: () -> Unit,
    onOpenRewards: () -> Unit,
    onOpenCommunity: () -> Unit,
    onOpenWebsite: () -> Unit
) {
    val context = LocalContext.current
    var name by remember { mutableStateOf("Citizen") }
    var reports by remember { mutableStateOf<List<NativeReport>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(userId, refresh) {
        loading = true
        error = ""
        try {
            val profile = client.from("profiles").select(columns = Columns.raw("display_name,city,ward,account_type")) {
                filter { eq("id", userId) }
                limit(1)
            }.decodeList<NativeProfileSummary>().firstOrNull()
            name = profile?.displayName?.takeIf { it.isNotBlank() }
                ?: client.auth.currentUserOrNull()?.email?.substringBefore("@")
                ?: "Citizen"
            reports = NativeReportsRepository(client, context.contentResolver).loadMyReports(userId)
        } catch (exception: Exception) {
            error = "Your dashboard could not refresh. Check your connection and try again."
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxSize().background(ShellNavy)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("LokPravaah", color = ShellMint, fontSize = 25.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp)
                        Text("CITIZEN IMPACT PLATFORM", color = ShellMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    }
                    Surface(color = ShellCard, shape = CircleShape, modifier = Modifier.size(44.dp)) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(name.take(1).uppercase(), color = ShellMint, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        }
                    }
                }
            }
            item {
                AnimatedVisibility(visible = true, enter = fadeIn(tween(500)) + slideInVertically(initialOffsetY = { it / 8 }, animationSpec = tween(420, easing = FastOutSlowInEasing))) {
                    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("Good to see you,", color = ShellMuted, fontSize = 14.sp)
                        Text(name.replaceFirstChar { it.uppercase() } + ".", color = ShellText, fontSize = 30.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
                        Text("Let's make your neighbourhood better.", color = ShellMuted, fontSize = 13.sp)
                    }
                }
            }
            item {
                Surface(
                    shape = RoundedCornerShape(26.dp),
                    color = ShellMint,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box(
                        Modifier.background(Brush.linearGradient(listOf(Color(0xFFD5FFE8), ShellMint, Color(0xFF8BE5C0))))
                            .padding(21.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(color = Color(0xFF0E493B).copy(alpha = 0.10f), shape = RoundedCornerShape(100.dp)) {
                                    Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(Icons.Outlined.Campaign, contentDescription = null, tint = Color(0xFF0B5945), modifier = Modifier.size(15.dp))
                                        Text("CITIZEN POWER", color = Color(0xFF0B5945), fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.sp)
                                    }
                                }
                                Spacer(Modifier.weight(1f))
                                Icon(Icons.Outlined.TrendingUp, contentDescription = null, tint = Color(0xFF0B5945), modifier = Modifier.size(25.dp))
                            }
                            Text("Small actions.\nReal change.", color = Color(0xFF08251D), fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 31.sp)
                            Text("Spot an issue, raise your voice, and follow its progress in one place.", color = Color(0xFF245546), fontSize = 13.sp, lineHeight = 19.sp)
                            Button(
                                onClick = onOpenReports,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(15.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF092A22), contentColor = ShellMint)
                            ) {
                                Text("Report a civic issue", fontWeight = FontWeight.Bold)
                                Spacer(Modifier.width(6.dp))
                                Icon(Icons.Outlined.ArrowForward, contentDescription = null, modifier = Modifier.size(17.dp))
                            }
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("Your impact", color = ShellText, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                    TextButton(onClick = { refresh++ }, enabled = !loading) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null, tint = ShellMint, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Refresh", color = ShellMint, fontSize = 12.sp)
                    }
                }
                if (loading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = ShellMint, trackColor = ShellCard)
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.fillMaxWidth()) {
                        NativeMetricCard("TOTAL", reports.size.toString(), Icons.Outlined.Description, ShellBlue, Modifier.weight(1f))
                        NativeMetricCard("IN PROGRESS", reports.count { it.status in listOf("submitted", "under_review", "verified", "in_progress") }.toString(), Icons.Outlined.Timeline, ShellAmber, Modifier.weight(1f))
                        NativeMetricCard("RESOLVED", reports.count { it.status == "resolved" }.toString(), Icons.Outlined.CheckCircle, ShellMint, Modifier.weight(1f))
                    }
                }
                if (error.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(error, color = ShellRose, fontSize = 12.sp)
                }
            }
            item {
                Text("Explore LokPravaah", color = ShellText, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    NativeQuickAction("My reports", "Track progress", Icons.Outlined.ReceiptLong, ShellBlue, onOpenReports, Modifier.weight(1f))
                    NativeQuickAction("Rewards", "Your contribution", Icons.Outlined.MonetizationOn, ShellAmber, onOpenRewards, Modifier.weight(1f))
                }
                Spacer(Modifier.height(10.dp))
                NativeQuickAction("Community", "Talk with neighbours", Icons.Outlined.ChatBubbleOutline, ShellMint, onOpenCommunity, Modifier.fillMaxWidth())
            }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Recent reports", color = ShellText, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                        Text("The latest updates from your account", color = ShellMuted, fontSize = 12.sp)
                    }
                    TextButton(onClick = onOpenReports) { Text("View all", color = ShellMint) }
                }
            }
            if (!loading && reports.isEmpty()) {
                item {
                    Surface(color = ShellSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.Start) {
                            Surface(color = ShellCard, shape = CircleShape, modifier = Modifier.size(46.dp)) {
                                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = ShellMint, modifier = Modifier.size(23.dp)) }
                            }
                            Text("Your first report starts here", color = ShellText, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Text("Submit a local issue and track its status and timeline directly from the app.", color = ShellMuted, fontSize = 13.sp, lineHeight = 19.sp)
                            TextButton(onClick = onOpenReports) { Text("Create your first report", color = ShellMint) }
                        }
                    }
                }
            } else if (!loading) {
                items(reports.take(3), key = { it.id }) { report ->
                    NativeRecentReport(report = report, onClick = onOpenReports)
                }
            }
            item {
                TextButton(onClick = onOpenWebsite, modifier = Modifier.fillMaxWidth()) {
                    Text("Open full LokPravaah website", color = ShellMuted, fontSize = 12.sp)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Outlined.ArrowForward, contentDescription = null, tint = ShellMuted, modifier = Modifier.size(14.dp))
                }
            }
        }
    }
}

@Composable
private fun NativeMetricCard(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, modifier: Modifier) {
    Surface(color = ShellSurface, shape = RoundedCornerShape(17.dp), modifier = modifier) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(19.dp))
            Text(value, color = ShellText, fontSize = 23.sp, fontWeight = FontWeight.ExtraBold)
            Text(label, color = ShellMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, lineHeight = 12.sp)
        }
    }
}

@Composable
private fun NativeQuickAction(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, onClick: () -> Unit, modifier: Modifier) {
    Surface(
        color = ShellSurface,
        shape = RoundedCornerShape(18.dp),
        modifier = modifier.clickable(onClick = onClick)
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Surface(color = color.copy(alpha = 0.12f), shape = RoundedCornerShape(13.dp), modifier = Modifier.size(42.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(21.dp)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, color = ShellText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                Text(subtitle, color = ShellMuted, fontSize = 10.sp, lineHeight = 13.sp)
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = ShellMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun NativeRecentReport(report: NativeReport, onClick: () -> Unit) {
    Surface(color = ShellSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = ShellCard, shape = RoundedCornerShape(13.dp), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.ReportProblem, contentDescription = null, tint = ShellMint, modifier = Modifier.size(22.dp)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(report.title, color = ShellText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1)
                Text(report.addressLabel.orEmpty().ifBlank { report.category }, color = ShellMuted, fontSize = 11.sp, maxLines = 1)
                Text(report.publicCode, color = ShellMint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            }
            NativeStatusPill(report.status)
        }
    }
}

@Composable
private fun NativeRewardsScreen(client: SupabaseClient, userId: String) {
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf<NativeRewardSettings?>(null) }
    var balance by remember { mutableStateOf<NativeRewardBalance?>(null) }
    var ledger by remember { mutableStateOf<List<NativeRewardLedger>>(emptyList()) }
    var withdrawals by remember { mutableStateOf<List<NativeRewardWithdrawal>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var pointsText by remember { mutableStateOf("") }
    var upiText by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Your session has expired. Please sign in again." }
            val rewardFlag = client.from("app_feature_flags").select(columns = Columns.raw("flag_key,enabled")) {
                filter { eq("flag_key", "rewards") }; limit(1)
            }.decodeList<NativeFeatureFlag>().firstOrNull()?.enabled ?: false
            check(rewardFlag) { "Rewards are temporarily disabled by the administrator." }
            settings = client.from("reward_settings").select(columns = Columns.raw("enabled,cash_redemption_enabled,min_withdrawal_points,enabled_payout_methods")) {
                filter { eq("id", true) }; limit(1)
            }.decodeList<NativeRewardSettings>().firstOrNull()
            val balanceRows = client.postgrest.rpc("janwatch_reward_balance").decodeList<NativeRewardBalance>()
            balance = balanceRows.firstOrNull()
            ledger = client.from("reward_ledger").select(columns = Columns.raw("id,delta_points,reason,created_at,source_report_id")) {
                filter { eq("user_id", userId) }
                order("created_at", Order.DESCENDING)
                limit(30)
            }.decodeList<NativeRewardLedger>()
            withdrawals = client.from("reward_withdrawals").select(columns = Columns.raw("id,points_requested,payout_method,status,admin_note,created_at,processed_at")) {
                filter { eq("user_id", userId) }
                order("created_at", Order.DESCENDING)
                limit(20)
            }.decodeList<NativeRewardWithdrawal>()
        } catch (exception: Exception) {
            error = shellFriendlyError(exception)
        } finally { loading = false }
    }

    val currentSettings = settings
    val currentBalance = balance
    val canRequest = !loading && error.isBlank() && currentSettings?.enabled == true &&
        currentSettings.cashRedemptionEnabled &&
        currentSettings.enabledPayoutMethods.contains("UPI") &&
        (currentBalance?.availablePoints ?: 0L) >= (currentSettings.minWithdrawalPoints.toLong())

    Column(Modifier.fillMaxSize().background(ShellNavy)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { NativePageHeader("Rewards", "Your contributions, tracked transparently", Icons.Outlined.AccountBalanceWallet, onRefresh = { refresh++ }, loading = loading) }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = ShellMint, trackColor = ShellCard) }
            if (error.isNotBlank()) item { NativeErrorCard(error, onRetry = { refresh++ }) }
            if (!loading && error.isBlank() && currentBalance != null) {
                item {
                    Surface(shape = RoundedCornerShape(25.dp), color = ShellMint, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.background(Brush.linearGradient(listOf(Color(0xFFD7FFEA), ShellMint, Color(0xFF8FE5BF)))).padding(21.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.MonetizationOn, contentDescription = null, tint = Color(0xFF0D4C3A), modifier = Modifier.size(25.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("AVAILABLE REWARD POINTS", color = Color(0xFF0D4C3A), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                            }
                            Text(currentBalance.availablePoints.toString(), color = Color(0xFF07271D), fontSize = 38.sp, fontWeight = FontWeight.ExtraBold)
                            Text("Points are calculated by the secure Supabase balance function.", color = Color(0xFF245546), fontSize = 12.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                NativeTinyStat("Earned", currentBalance.earnedPoints.toString(), Modifier.weight(1f))
                                NativeTinyStat("Reserved", currentBalance.reservedPoints.toString(), Modifier.weight(1f))
                            }
                        }
                    }
                }
                if (currentSettings?.cashRedemptionEnabled != true) {
                    item {
                        Surface(color = ShellSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(15.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                                Icon(Icons.Outlined.Lock, contentDescription = null, tint = ShellAmber, modifier = Modifier.size(21.dp))
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("Redemption is not active yet", color = ShellText, fontWeight = FontWeight.Bold)
                                    Text("You can view your verified points. Withdrawal requests remain unavailable until an administrator enables the redemption programme.", color = ShellMuted, fontSize = 12.sp, lineHeight = 18.sp)
                                }
                            }
                        }
                    }
                } else if (canRequest) {
                    item {
                        Surface(color = ShellSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                                Text("Request a UPI withdrawal", color = ShellText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                                Text("The server checks your balance and sends the request for administrator review. Requesting does not guarantee payment.", color = ShellMuted, fontSize = 12.sp, lineHeight = 18.sp)
                                OutlinedTextField(
                                    value = pointsText, onValueChange = { pointsText = it.filter(Char::isDigit).take(9) },
                                    label = { Text("Points to redeem") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    modifier = Modifier.fillMaxWidth(), enabled = !sending,
                                    colors = shellFieldColors()
                                )
                                OutlinedTextField(
                                    value = upiText, onValueChange = { upiText = it.take(120) },
                                    label = { Text("UPI ID") }, placeholder = { Text("name@bank") }, singleLine = true,
                                    modifier = Modifier.fillMaxWidth(), enabled = !sending, colors = shellFieldColors()
                                )
                                Button(onClick = {
                                    val points = pointsText.toIntOrNull()
                                    val upi = upiText.trim()
                                    when {
                                        points == null || points < (currentSettings?.minWithdrawalPoints ?: Int.MAX_VALUE) -> message = "Enter at least the configured minimum points."
                                        points.toLong() > (currentBalance?.availablePoints ?: 0L) -> message = "The requested points exceed your available balance."
                                        !Regex("^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$").matches(upi) -> message = "Enter a valid UPI ID."
                                        else -> {
                                            sending = true; message = ""
                                            scope.launch {
                                                try {
                                                    client.postgrest.rpc(
                                                        function = "janwatch_request_reward_withdrawal",
                                                        parameters = buildJsonObject {
                                                            put("p_points", points)
                                                            put("p_method", "UPI")
                                                            put("p_destination", upi)
                                                        }
                                                    )
                                                    pointsText = ""; upiText = ""
                                                    message = "Request submitted for administrator review."
                                                    refresh++
                                                } catch (exception: Exception) {
                                                    message = shellFriendlyError(exception)
                                                } finally { sending = false }
                                            }
                                        }
                                    }
                                }, enabled = !sending, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = ShellMint, contentColor = ShellNavy)) {
                                    if (sending) CircularProgressIndicator(Modifier.size(18.dp), color = ShellNavy)
                                    else Text("Submit withdrawal request", fontWeight = FontWeight.Bold)
                                }
                                if (message.isNotBlank()) Text(message, color = if (message.contains("submitted", true)) ShellMint else ShellAmber, fontSize = 12.sp)
                            }
                        }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Points history", color = ShellText, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        if (ledger.isEmpty()) NativeEmptyCard("No points earned yet", "Points will appear here when a verified contribution earns them.")
                        else ledger.forEach { row -> NativeLedgerRow(row) }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Withdrawal requests", color = ShellText, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        if (withdrawals.isEmpty()) NativeEmptyCard("No withdrawal requests", "When withdrawals are enabled, your submitted requests and statuses will appear here.")
                        else withdrawals.forEach { row -> NativeWithdrawalRow(row) }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeCommunityScreen(client: SupabaseClient, userId: String) {
    val scope = rememberCoroutineScope()
    var messages by remember { mutableStateOf<List<NativeCommunityMessage>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var sending by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Your session has expired. Please sign in again." }
            enabled = client.from("app_feature_flags").select(columns = Columns.raw("flag_key,enabled")) {
                filter { eq("flag_key", "public_chat") }; limit(1)
            }.decodeList<NativeFeatureFlag>().firstOrNull()?.enabled ?: false
            if (enabled) {
                messages = client.from("community_messages").select(columns = Columns.raw("id,user_id,author_name,body,is_hidden,created_at")) {
                    order("created_at", Order.DESCENDING)
                    limit(100)
                }.decodeList<NativeCommunityMessage>().reversed()
            } else {
                messages = emptyList()
            }
        } catch (exception: Exception) {
            error = shellFriendlyError(exception)
        } finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(ShellNavy)) {
        Column(Modifier.weight(1f)) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(13.dp)
            ) {
                item { NativePageHeader("Community", "Constructive conversation, local impact", Icons.Outlined.Forum, onRefresh = { refresh++ }, loading = loading) }
                item {
                    Surface(color = ShellSurface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                            Icon(Icons.Outlined.Shield, contentDescription = null, tint = ShellMint, modifier = Modifier.size(20.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Keep the community safe", color = ShellText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Text("Be respectful. Stick to civic issues. Do not post private addresses, phone numbers, passwords or sensitive documents. Chat is not an emergency service.", color = ShellMuted, fontSize = 11.sp, lineHeight = 17.sp)
                            }
                        }
                    }
                }
                if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = ShellMint, trackColor = ShellCard) }
                if (error.isNotBlank()) item { NativeErrorCard(error, onRetry = { refresh++ }) }
                if (!loading && error.isBlank() && !enabled) item { NativeEmptyCard("Community chat is paused", "The administrator has temporarily disabled public community chat.") }
                if (!loading && error.isBlank() && enabled && messages.isEmpty()) item { NativeEmptyCard("Start a constructive conversation", "No messages yet. Share a useful update or a question about local civic issues.") }
                if (enabled && error.isBlank()) items(messages, key = { it.id }) { message ->
                    val own = message.userId == userId
                    Surface(
                        color = if (own) Color(0xFF102D36) else ShellSurface,
                        shape = RoundedCornerShape(topStart = 17.dp, topEnd = 17.dp, bottomEnd = if (own) 5.dp else 17.dp, bottomStart = if (own) 17.dp else 5.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                Surface(color = if (own) ShellMint.copy(alpha = 0.15f) else ShellCard, shape = CircleShape, modifier = Modifier.size(29.dp)) {
                                    Box(contentAlignment = Alignment.Center) { Text(message.authorName.take(1).uppercase(), color = ShellMint, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                                }
                                Text(if (own) "You" else message.authorName.ifBlank { "Citizen" }, color = ShellText, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                Spacer(Modifier.weight(1f))
                                Text(shortShellDate(message.createdAt), color = ShellMuted, fontSize = 9.sp)
                            }
                            Text(message.body, color = ShellText, fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                }
            }
        }
        if (enabled && error.isBlank()) {
            Surface(color = ShellSurface, shadowElevation = 8.dp) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft, onValueChange = { draft = it.take(2000) },
                        placeholder = { Text("Share a helpful update…") }, modifier = Modifier.weight(1f),
                        enabled = !sending, minLines = 1, maxLines = 3, colors = shellFieldColors()
                    )
                    Button(
                        onClick = {
                            val body = draft.trim()
                            if (body.isBlank()) return@Button
                            sending = true
                            scope.launch {
                                try {
                                    check(client.auth.currentUserOrNull()?.id == userId) { "Your session has expired. Please sign in again." }
                                    client.from("community_messages").insert(NativeCommunityMessageInsert(userId, body))
                                    draft = ""
                                    refresh++
                                } catch (exception: Exception) {
                                    error = shellFriendlyError(exception)
                                } finally { sending = false }
                            }
                        },
                        enabled = !sending && draft.isNotBlank(),
                        modifier = Modifier.size(52.dp),
                        contentPadding = PaddingValues(0.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ShellMint, contentColor = ShellNavy)
                    ) {
                        if (sending) CircularProgressIndicator(Modifier.size(17.dp), color = ShellNavy)
                        else Icon(Icons.Outlined.ArrowForward, contentDescription = "Send message")
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeProfileScreen(client: SupabaseClient, userId: String, onOpenWebsite: () -> Unit, onSignedOut: () -> Unit) {
    var profile by remember { mutableStateOf<NativeProfileSummary?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var signoutLoading by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val email = client.auth.currentUserOrNull()?.email.orEmpty()

    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Your session has expired. Please sign in again." }
            profile = client.from("profiles").select(columns = Columns.raw("display_name,city,ward,account_type")) {
                filter { eq("id", userId) }; limit(1)
            }.decodeList<NativeProfileSummary>().firstOrNull()
        } catch (exception: Exception) {
            error = shellFriendlyError(exception)
        } finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(ShellNavy)) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(15.dp)
        ) {
            item { NativePageHeader("Your profile", "Account information and app preferences", Icons.Outlined.Person, onRefresh = { refresh++ }, loading = loading) }
            item {
                Surface(color = ShellSurface, shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Surface(color = ShellMint, shape = CircleShape, modifier = Modifier.size(76.dp)) {
                            Box(contentAlignment = Alignment.Center) { Text((profile?.displayName?.takeIf { it.isNotBlank() } ?: email.substringBefore("@")).take(1).uppercase(), color = ShellNavy, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp) }
                        }
                        Text(profile?.displayName?.ifBlank { "Citizen" } ?: "Citizen", color = ShellText, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                        Text(email, color = ShellMuted, fontSize = 12.sp)
                        Surface(color = ShellCard, shape = RoundedCornerShape(100.dp)) {
                            Text("VERIFIED SESSION", color = ShellMint, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp))
                        }
                    }
                }
            }
            item {
                Surface(color = ShellSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(15.dp)) {
                        ProfileDetail("City / town", profile?.city ?: "Not provided")
                        HorizontalDivider(color = ShellLine)
                        ProfileDetail("Ward / local area", profile?.ward ?: "Not provided")
                        HorizontalDivider(color = ShellLine)
                        ProfileDetail("Account type", profile?.accountType ?: "Citizen")
                    }
                }
            }
            if (error.isNotBlank()) item { NativeErrorCard(error, onRetry = { refresh++ }) }
            item {
                OutlinedButton(onClick = onOpenWebsite, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(15.dp)) {
                    Text("Open full LokPravaah website", color = ShellText)
                }
                Spacer(Modifier.height(3.dp))
                Button(
                    onClick = {
                        signoutLoading = true
                        scope.launch {
                            try {
                                client.auth.signOut()
                                onSignedOut()
                            } catch (exception: Exception) {
                                error = "Could not sign out. Check your connection and try again."
                            } finally { signoutLoading = false }
                        }
                    },
                    enabled = !signoutLoading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(15.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38212E), contentColor = ShellRose)
                ) {
                    if (signoutLoading) CircularProgressIndicator(Modifier.size(18.dp), color = ShellRose)
                    else Text("Sign out securely")
                }
            }
        }
    }
}

@Composable
private fun NativePageHeader(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onRefresh: () -> Unit, loading: Boolean) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(color = ShellCard, shape = RoundedCornerShape(15.dp), modifier = Modifier.size(48.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, tint = ShellMint, modifier = Modifier.size(25.dp)) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, color = ShellText, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
            Text(subtitle, color = ShellMuted, fontSize = 11.sp, lineHeight = 15.sp)
        }
        IconButton(onClick = onRefresh, enabled = !loading) {
            Icon(Icons.Outlined.Refresh, contentDescription = "Refresh", tint = if (loading) ShellMuted else ShellMint)
        }
    }
}

@Composable
private fun NativeTinyStat(label: String, value: String, modifier: Modifier) {
    Surface(color = Color(0xFF0B4938).copy(alpha = 0.08f), shape = RoundedCornerShape(13.dp), modifier = modifier) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(label, color = Color(0xFF245546), fontSize = 10.sp)
            Text(value, color = Color(0xFF092D22), fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun NativeLedgerRow(row: NativeRewardLedger) {
    Surface(color = ShellSurface, shape = RoundedCornerShape(15.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Surface(color = if (row.deltaPoints >= 0) ShellMint.copy(alpha = 0.12f) else ShellRose.copy(alpha = 0.12f), shape = CircleShape, modifier = Modifier.size(38.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(if (row.deltaPoints >= 0) Icons.Outlined.TrendingUp else Icons.Outlined.SouthEast, contentDescription = null, tint = if (row.deltaPoints >= 0) ShellMint else ShellRose, modifier = Modifier.size(19.dp)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(row.reason, color = ShellText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(shortShellDate(row.createdAt), color = ShellMuted, fontSize = 10.sp)
            }
            Text((if (row.deltaPoints > 0) "+" else "") + row.deltaPoints, color = if (row.deltaPoints >= 0) ShellMint else ShellRose, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun NativeWithdrawalRow(row: NativeRewardWithdrawal) {
    val statusColor = when (row.status.lowercase()) {
        "paid" -> ShellMint
        "approved" -> ShellBlue
        "rejected" -> ShellRose
        else -> ShellAmber
    }
    Surface(color = ShellSurface, shape = RoundedCornerShape(15.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(13.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AccountBalanceWallet, contentDescription = null, tint = statusColor, modifier = Modifier.size(22.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.pointsRequested.toString() + " points · " + row.payoutMethod, color = ShellText, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                Text(shortShellDate(row.createdAt), color = ShellMuted, fontSize = 10.sp)
                if (!row.adminNote.isNullOrBlank()) Text(row.adminNote, color = ShellMuted, fontSize = 11.sp)
            }
            Surface(color = statusColor.copy(alpha = 0.12f), shape = RoundedCornerShape(100.dp)) {
                Text(row.status.replaceFirstChar { it.uppercase() }, color = statusColor, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp))
            }
        }
    }
}

@Composable
private fun NativeEmptyCard(title: String, message: String) {
    Surface(color = ShellSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, color = ShellText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(message, color = ShellMuted, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
private fun NativeErrorCard(message: String, onRetry: () -> Unit) {
    Surface(color = Color(0xFF34222B), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Unable to load this section", color = ShellRose, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(message, color = ShellMuted, fontSize = 12.sp, lineHeight = 17.sp)
            TextButton(onClick = onRetry) { Text("Try again", color = ShellMint) }
        }
    }
}

@Composable
private fun NativeStatusPill(status: String) {
    val color = when (status.lowercase()) {
        "resolved" -> ShellMint
        "verified" -> ShellBlue
        "in_progress", "under_review" -> ShellAmber
        "rejected" -> ShellRose
        else -> ShellMuted
    }
    Surface(color = color.copy(alpha = 0.13f), shape = RoundedCornerShape(100.dp)) {
        Text(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, color = color, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
    }
}

@Composable
private fun ProfileDetail(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = ShellMuted, fontSize = 11.sp)
        Text(value, color = ShellText, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun shellFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = ShellText,
    unfocusedTextColor = ShellText,
    disabledTextColor = ShellMuted,
    focusedContainerColor = ShellCard,
    unfocusedContainerColor = ShellCard,
    disabledContainerColor = ShellCard,
    focusedBorderColor = ShellMint,
    unfocusedBorderColor = ShellLine,
    disabledBorderColor = ShellLine,
    focusedLabelColor = ShellMint,
    unfocusedLabelColor = ShellMuted,
    focusedPlaceholderColor = ShellMuted,
    unfocusedPlaceholderColor = ShellMuted,
    cursorColor = ShellMint
)

private fun shellFriendlyError(exception: Throwable): String {
    val raw = exception.message.orEmpty()
    val lowered = raw.lowercase()
    return when {
        lowered.contains("session has expired") || lowered.contains("jwt") || lowered.contains("not authenticated") -> "Your session may have expired. Sign in again and retry."
        lowered.contains("row-level security") || lowered.contains("permission denied") || lowered.contains("403") -> "Supabase denied this action under the current account permissions."
        lowered.contains("cash redemptions are not enabled") -> "Cash redemption is not enabled yet. Your points remain visible; ask an administrator about the rewards programme."
        lowered.contains("rewards are currently disabled") || lowered.contains("feature is disabled") -> "This feature is temporarily disabled by an administrator."
        lowered.contains("relation") && lowered.contains("does not exist") -> "This backend feature is not available in the connected database yet. No tables were created or permissions bypassed."
        else -> "The request could not be completed. Check your connection and try again."
    }
}

private fun shortShellDate(value: String): String {
    return try {
        DateTimeFormatter.ofPattern("dd MMM, HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    } catch (_: Exception) { "Date unavailable" }
}

@Serializable
private data class NativeFeatureFlag(@SerialName("flag_key") val key: String, val enabled: Boolean)

@Serializable
private data class NativeProfileSummary(
    @SerialName("display_name") val displayName: String? = null,
    val city: String? = null,
    val ward: String? = null,
    @SerialName("account_type") val accountType: String? = null
)

@Serializable
private data class NativeRewardSettings(
    val enabled: Boolean = true,
    @SerialName("cash_redemption_enabled") val cashRedemptionEnabled: Boolean = false,
    @SerialName("points_per_rupee") val pointsPerRupee: Double = 100.0,
    @SerialName("min_withdrawal_points") val minWithdrawalPoints: Int = 10000,
    @SerialName("enabled_payout_methods") val enabledPayoutMethods: List<String> = listOf("UPI")
)

@Serializable
private data class NativeRewardBalance(
    @SerialName("earned_points") val earnedPoints: Long = 0,
    @SerialName("reserved_points") val reservedPoints: Long = 0,
    @SerialName("available_points") val availablePoints: Long = 0
)

@Serializable
private data class NativeRewardLedger(
    val id: String,
    @SerialName("delta_points") val deltaPoints: Int,
    val reason: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("source_report_id") val sourceReportId: String? = null
)

@Serializable
private data class NativeRewardWithdrawal(
    val id: String,
    @SerialName("points_requested") val pointsRequested: Int,
    @SerialName("payout_method") val payoutMethod: String,
    val status: String,
    @SerialName("admin_note") val adminNote: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("processed_at") val processedAt: String? = null
)

@Serializable
private data class NativeCommunityMessage(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("author_name") val authorName: String = "Citizen",
    val body: String,
    @SerialName("is_hidden") val isHidden: Boolean = false,
    @SerialName("created_at") val createdAt: String
)

@Serializable
private data class NativeCommunityMessageInsert(
    @SerialName("user_id") val userId: String,
    val body: String
)
