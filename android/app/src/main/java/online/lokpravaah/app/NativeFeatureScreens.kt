package online.lokpravaah.app

import android.content.Intent
import android.graphics.Bitmap
import android.content.ContentValues
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.storage.storage
import io.ktor.http.ContentType
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker

private data class NativeMoreItem(
    val title: String,
    val subtitle: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val action: () -> Unit
)

private val FxNavy = Color(0xFF06111F)
private val FxSurface = Color(0xFF0E1D30)
private val FxCard = Color(0xFF11263B)
private val FxMint = Color(0xFFB6F4D7)
private val FxText = Color(0xFFF5F9FF)
private val FxMuted = Color(0xFF9BB1C8)
private val FxLine = Color(0xFF263E56)
private val FxBlue = Color(0xFF7CB9FF)
private val FxAmber = Color(0xFFF8D58B)
private val FxRose = Color(0xFFFFA9B2)

@Composable
fun NativeMoreScreen(onSelect: (CitizenTab) -> Unit) {
    val modules = listOf(
        NativeMoreItem("LokPravaah AI", "General, legal, civic and document assistance", Icons.Outlined.AutoAwesome) { onSelect(CitizenTab.AI) },
        NativeMoreItem("Civic toolkit", "Draft complaints, RTI requests and project checklists", Icons.Outlined.Assignment) { onSelect(CitizenTab.CIVIC_TOOLKIT) },
        NativeMoreItem("Explore public reports", "Browse civic issues and open their locations", Icons.Outlined.Map) { onSelect(CitizenTab.EXPLORE_MAP) },
        NativeMoreItem("Rewards", "Review points history and withdrawal status", Icons.Outlined.AccountBalanceWallet) { onSelect(CitizenTab.REWARDS) },
        NativeMoreItem("Worker Hub", "Apply as a volunteer and manage assigned tasks", Icons.Outlined.VolunteerActivism) { onSelect(CitizenTab.WORKER_HUB) },
        NativeMoreItem("Refer & Earn", "Your referral code and verified referral activity", Icons.Outlined.GroupAdd) { onSelect(CitizenTab.REFERRALS) },
        NativeMoreItem("Donate", "Campaign progress, donor information and secure checkout", Icons.Outlined.Favorite) { onSelect(CitizenTab.DONATE) },
        NativeMoreItem("Support tickets", "Report account, payment or technical problems", Icons.Outlined.SupportAgent) { onSelect(CitizenTab.SUPPORT) },
        NativeMoreItem("My profile", "Account information and secure sign-out", Icons.Outlined.Person) { onSelect(CitizenTab.PROFILE) },
        NativeMoreItem("How it works", "A quick native guide to civic reporting", Icons.Outlined.MenuBook) { onSelect(CitizenTab.HOW_IT_WORKS) },
        NativeMoreItem("Blog & updates", "Read published LokPravaah posts in the app", Icons.Outlined.Article) { onSelect(CitizenTab.BLOG) },
        NativeMoreItem("Downloads", "Get files published by the LokPravaah team", Icons.Outlined.Download) { onSelect(CitizenTab.DOWNLOADS) }
    )
    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item { FxHeader("Explore LokPravaah", "Everyday civic tools in one workspace", Icons.Outlined.Widgets) }
            item {
                Surface(
                    color = FxMint,
                    shape = RoundedCornerShape(23.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        Modifier.background(Brush.linearGradient(listOf(Color(0xFFD7FFEA), FxMint, Color(0xFF8FE5BF)))).padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp)
                    ) {
                        Text("One app. One civic workspace.", color = Color(0xFF08251D), fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                        Text("AI, reports, guidance, updates and published downloads all stay inside this native app. Your account and civic data use the same secure backend as the website.", color = Color(0xFF245546), fontSize = 12.sp, lineHeight = 18.sp)
                    }
                }
            }
            items(modules) { item ->
                Surface(color = FxSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth().clickable { item.action() }) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(color = FxCard, shape = RoundedCornerShape(13.dp), modifier = Modifier.size(43.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(item.icon, contentDescription = null, tint = FxMint, modifier = Modifier.size(22.dp)) }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(item.title, color = FxText, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(item.subtitle, color = FxMuted, fontSize = 11.sp, lineHeight = 16.sp)
                        }
                        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = FxMuted)
                    }
                }
            }
        }
    }
}

@Composable
fun NativeCivicToolkitScreen() {
    val context = LocalContext.current
    var tab by remember { mutableStateOf("Complaint") }
    var name by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var ward by remember { mutableStateOf("") }
    var authority by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var details by remember { mutableStateOf("") }
    var desired by remember { mutableStateOf("") }
    var period by remember { mutableStateOf("") }
    var records by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    val checks = listOf(
        "Administrative approval / sanction order",
        "Sanctioned cost and itemised estimate",
        "Tender, work order and contractor details",
        "Original completion date and approved extensions",
        "Dated, location-specific site photos",
        "Quality inspection or completion certificate",
        "Measurement book, bills or payment records",
        "Written clarification from the responsible authority"
    )
    var selectedChecks by remember { mutableStateOf(emptySet<String>()) }

    val draft = when (tab) {
        "Complaint" -> listOf(
            "DRAFT CIVIC GRIEVANCE / REPRESENTATION",
            "Prepared on: " + java.time.LocalDate.now().toString(),
            "From: " + name.ifBlank { "[Your name]" },
            "City / town: " + city.ifBlank { "[City]" } + " · Ward: " + ward.ifBlank { "[Ward]" },
            "To: " + authority.ifBlank { "[Responsible department / authority]" },
            "Subject: " + subject.ifBlank { "[Brief factual subject]" },
            "Location: " + location.ifBlank { "[Street / landmark / ward]" },
            "", "Observed facts:", details.ifBlank { "[Describe what you personally observed, with dates where possible.]" },
            "", "Requested action:", desired.ifBlank { "[State a reasonable inspection, repair or written response requested.]" },
            "", "This is a draft and has not been submitted. Keep a copy and use the responsible authority's official channel."
        ).joinToString("\n")
        "RTI request" -> listOf(
            "DRAFT RIGHT TO INFORMATION REQUEST",
            "Applicant: " + name.ifBlank { "[Your name]" },
            "Address / location: " + listOf(ward, city).filter { it.isNotBlank() }.joinToString(", ").ifBlank { "[Your postal address]" },
            "Public authority: " + authority.ifBlank { "[Correct public authority / PIO]" },
            "Period covered: " + period.ifBlank { "[Date range]" },
            "", "Records requested:", records.ifBlank { "[List specific existing records, documents, orders, bills or file notings.]" },
            "", "Please provide the records in the permitted form and advise any applicable fee or lawful exemption.",
            "", "This is a draft only. Confirm the applicable authority, fee, format and current RTI procedure before submitting."
        ).joinToString("\n")
        else -> listOf(
            "PUBLIC PROJECT DOCUMENT CHECKLIST",
            "Project: " + subject.ifBlank { "[Project name]" },
            "Location: " + location.ifBlank { "[Location]" },
            "Authority: " + authority.ifBlank { "[Department]" },
            "", "Documents / observations to check:",
            if (selectedChecks.isEmpty()) "[Select the relevant checks in the app]" else selectedChecks.joinToString("\n") { "• " + it },
            "", "Observations (facts only):", details.ifBlank { "[What you observed and when]" },
            "", "A missing record or cost difference alone does not prove wrongdoing. Verify the relevant documents and ask for clarification."
        ).joinToString("\n")
    }

    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(17.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { FxHeader("Civic toolkit", "Prepare clear drafts and preserve facts", Icons.Outlined.Assignment) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("Complaint", "RTI request", "Project checklist").forEach { option ->
                        val selected = option == tab
                        Surface(
                            color = if (selected) FxMint else FxSurface,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.weight(1f).clickable { tab = option; notice = "" }
                        ) {
                            Text(option, color = if (selected) FxNavy else FxText, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 12.dp))
                        }
                    }
                }
            }
            item {
                Surface(color = FxSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(if (tab == "Complaint") "Complaint details" else if (tab == "RTI request") "RTI request details" else "Project verification checklist", color = FxText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        FxTextField(name, { name = it }, "Your name")
                        if (tab != "Project checklist") {
                            FxTextField(city, { city = it }, "City / town")
                            FxTextField(ward, { ward = it }, "Ward / local area")
                        }
                        FxTextField(authority, { authority = it }, "Department / public authority")
                        FxTextField(subject, { subject = it }, if (tab == "Project checklist") "Project name" else "Subject")
                        FxTextField(location, { location = it }, "Location / landmark")
                        if (tab == "RTI request") {
                            FxTextField(period, { period = it }, "Period covered")
                            FxTextField(records, { records = it }, "Specific records requested", minLines = 4)
                        } else {
                            FxTextField(details, { details = it }, if (tab == "Complaint") "Observed facts and dates" else "Project observations", minLines = 4)
                            if (tab == "Complaint") FxTextField(desired, { desired = it }, "Action requested", minLines = 2)
                        }
                        if (tab == "Project checklist") {
                            checks.forEach { item ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = item in selectedChecks, onCheckedChange = { on -> selectedChecks = if (on) selectedChecks + item else selectedChecks - item }, colors = CheckboxDefaults.colors(checkedColor = FxMint, checkmarkColor = FxNavy))
                                    Text(item, color = FxText, fontSize = 12.sp, lineHeight = 16.sp)
                                }
                            }
                        }
                        Button(
                            onClick = {
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_SUBJECT, "LokPravaah - " + tab + " draft")
                                    putExtra(Intent.EXTRA_TEXT, draft)
                                }
                                try {
                                    context.startActivity(Intent.createChooser(intent, "Save or share draft"))
                                    notice = "Draft prepared. Review it before submission."
                                } catch (_: Exception) { notice = "Draft prepared; copy the preview shown below." }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)
                        ) {
                            Icon(Icons.Outlined.Share, contentDescription = null)
                            Spacer(Modifier.width(7.dp))
                            Text("Share / save draft", fontWeight = FontWeight.Bold)
                        }
                        if (notice.isNotBlank()) Text(notice, color = FxMint, fontSize = 12.sp)
                    }
                }
            }
            item {
                Surface(color = FxSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Draft preview", color = FxMint, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text(draft, color = FxMuted, fontSize = 11.sp, lineHeight = 17.sp)
                        Text("Draft only · Nothing is submitted automatically.", color = FxAmber, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
fun NativeExploreScreen(client: SupabaseClient, userId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var reports by remember { mutableStateOf<List<NativePublicReport>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var supportNotice by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("All") }
    var selectedMapReport by remember { mutableStateOf<NativePublicReport?>(null) }
    var centeredReportId by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(userId) {
        while (true) {
            kotlinx.coroutines.delay(15_000)
            refresh++
        }
    }

    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Sign in again to view public reports." }
            val publicReports = client.from("reports").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                "id,public_code,title,description,category,status,address_label,created_at,latitude,longitude,visibility"
            )) {
                filter { eq("visibility", "public") }
                order("created_at", Order.DESCENDING)
                limit(100)
            }.decodeList<NativePublicReport>()
            val ownVotes = try {
                client.from("report_votes").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("report_id,user_id")) {
                    filter { eq("user_id", userId) }
                    limit(500)
                }.decodeList<NativeReportVote>().map { it.reportId }.toSet()
            } catch (_: Exception) { emptySet() }
            reports = publicReports.map { it.copy(supportedByMe = it.id in ownVotes) }
        } catch (exception: Exception) {
            reports = emptyList()
            error = "Public reports could not be loaded. Check your connection and database permissions."
        } finally { loading = false }
    }
    LaunchedEffect(userId) {
        while (true) {
            kotlinx.coroutines.delay(15_000)
            refresh++
        }
    }

    val visible = reports.filter { filter == "All" || it.status.equals(filter, ignoreCase = true) }
    val locatedReports = visible.filter { it.latitude != null && it.longitude != null }
    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            item { FxHeader("Explore map", "Public civic issues and their locations", Icons.Outlined.Map, onRefresh = { refresh++ }, loading = loading) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf("All", "submitted", "in_progress", "resolved").forEach { option ->
                        val sel = filter == option
                        Surface(color = if (sel) FxMint else FxSurface, shape = RoundedCornerShape(10.dp), modifier = Modifier.clickable { filter = option }) {
                            Text(if (option == "in_progress") "In progress" else option.replaceFirstChar { it.uppercase() }, color = if (sel) FxNavy else FxText, fontSize = 10.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp))
                        }
                    }
                }
            }
            item {
                Surface(color = FxSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("Live civic map", color = FxText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                Text(locatedReports.size.toString() + " real report locations", color = FxMuted, fontSize = 10.sp)
                            }
                            Icon(Icons.Outlined.Map, contentDescription = null, tint = FxMint)
                        }
                        if (locatedReports.isNotEmpty()) {
                            AndroidView(
                                modifier = Modifier.fillMaxWidth().height(300.dp),
                                factory = { mapContext ->
                                    Configuration.getInstance().userAgentValue = mapContext.packageName
                                    MapView(mapContext).apply {
                                        setTileSource(TileSourceFactory.MAPNIK)
                                        setMultiTouchControls(true)
                                        controller.setZoom(12.0)
                                    }
                                },
                                update = { mapView ->
                                    mapView.overlays.removeAll { it is Marker }
                                    locatedReports.forEach { report ->
                                        val latitude = report.latitude ?: return@forEach
                                        val longitude = report.longitude ?: return@forEach
                                        val marker = Marker(mapView).apply {
                                            position = GeoPoint(latitude, longitude)
                                            title = report.title
                                            snippet = report.publicCode + " · " + report.status.replace('_', ' ')
                                            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                                            setOnMarkerClickListener { _, _ ->
                                                selectedMapReport = report
                                                true
                                            }
                                        }
                                        mapView.overlays.add(marker)
                                    }
                                    val first = locatedReports.firstOrNull()
                                    if (first != null && centeredReportId != first.id) {
                                        mapView.controller.setCenter(GeoPoint(first.latitude!!, first.longitude!!))
                                        centeredReportId = first.id
                                    }
                                    mapView.invalidate()
                                }
                            )
                            selectedMapReport?.takeIf { it in locatedReports }?.let { picked ->
                                Surface(color = FxCard, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                                        Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = FxMint)
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                            Text(picked.title, color = FxText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                            Text(picked.publicCode + " · " + picked.status.replace('_', ' '), color = FxMuted, fontSize = 10.sp)
                                        }
                                    }
                                }
                            }
                        } else {
                            Surface(color = FxCard, shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth()) {
                                Row(Modifier.padding(13.dp), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.Info, contentDescription = null, tint = FxAmber)
                                    Text("No reports in this filter have saved GPS coordinates yet. The map won't invent locations.", color = FxMuted, fontSize = 11.sp, lineHeight = 16.sp)
                                }
                            }
                        }
                        Text("Tap a pin to view its report. Only saved latitude/longitude values are plotted.", color = FxMuted, fontSize = 10.sp, lineHeight = 15.sp)
                    }
                }
            }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = FxMint, trackColor = FxCard) }
            if (error.isNotBlank()) item { FxErrorCard(error) { refresh++ } }
            if (supportNotice.isNotBlank()) item { Text(supportNotice, color = FxMint, fontSize = 11.sp) }
            if (!loading && error.isBlank() && visible.isEmpty()) item { FxEmptyCard("No public reports found", "Refresh later or change the status filter.") }
            items(visible, key = { it.id }) { report ->
                Surface(color = FxSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(report.title, color = FxText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Text(report.publicCode, color = FxMint, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            }
                            FxStatusPill(report.status)
                        }
                        Text(report.category + " · " + report.addressLabel.orEmpty().ifBlank { "Area not recorded" }, color = FxMuted, fontSize = 11.sp)
                        if (report.description.isNotBlank()) Text(report.description.take(220), color = FxMuted, fontSize = 11.sp, lineHeight = 16.sp)
                        OutlinedButton(
                            onClick = {
                                scope@ run {
                                    supportNotice = ""
                                    if (report.supportedByMe) {
                                        supportNotice = "You have already supported this report."
                                    } else {
                                        scope.launch {
                                            try {
                                                val flag = client.from("app_feature_flags").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("enabled")) {
                                                    filter { eq("flag_key", "community_support") }; limit(1)
                                                }.decodeList<NativeWorkerSetting>().firstOrNull()?.enabled ?: false
                                                check(flag) { "Community support is temporarily unavailable. Please try again later." }
                                                check(client.auth.currentUserOrNull()?.id == userId) { "Sign in again to support a report." }
                                                client.from("report_votes").insert(NativeReportVoteInsert(report.id, userId))
                                                reports = reports.map { if (it.id == report.id) it.copy(supportedByMe = true) else it }
                                                supportNotice = "Your support was saved."
                                            } catch (exception: Exception) {
                                                supportNotice = if (exception.message.orEmpty().contains("duplicate", true) || exception.message.orEmpty().contains("unique", true)) {
                                                    "You have already supported this report."
                                                } else "Your support could not be saved. It may already be supported or the feature may be paused."
                                            }
                                        }
                                    }
                                }
                            },
                            enabled = !report.supportedByMe,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(if (report.supportedByMe) Icons.Outlined.CheckCircle else Icons.Outlined.ThumbUp, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(5.dp))
                            Text(if (report.supportedByMe) "Supported" else "Support this report")
                        }
                        if (report.latitude != null && report.longitude != null) {
                            OutlinedButton(onClick = {
                                val uri = Uri.parse("geo:" + report.latitude + "," + report.longitude + "?q=" + report.latitude + "," + report.longitude + "(" + Uri.encode(report.title) + ")")
                                try { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { error = "No map application is available on this device." }
                            }) {
                                Icon(Icons.Outlined.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("Open location")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun NativeWorkerScreen(client: SupabaseClient, userId: String) {
    val scope = rememberCoroutineScope()
    var city by remember { mutableStateOf("") }
    var ward by remember { mutableStateOf("") }
    var motivation by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var available by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(true) }
    var assignments by remember { mutableStateOf<List<NativeWorkerAssignment>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var activeTask by remember { mutableStateOf<NativeWorkerAssignment?>(null) }
    var message by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }
    var selectedSkills by remember { mutableStateOf(setOf("Waste & Sanitation", "Community outreach")) }
    val skills = listOf("Roads & Footpaths", "Waste & Sanitation", "Streetlights", "Water & Drainage", "Public Safety", "Parks & Public Spaces", "Community outreach", "Evidence collection", "Translation & writing", "Digital support")

    LaunchedEffect(userId, refresh) {
        loading = true; message = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Please sign in again." }
            enabled = client.from("worker_settings").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("enabled")) {
                filter { eq("id", true) }; limit(1)
            }.decodeList<NativeWorkerSetting>().firstOrNull()?.enabled ?: false
            val profile = client.from("worker_profiles").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("user_id,status,city,ward,skills,motivation,available,created_at")) {
                filter { eq("user_id", userId) }; limit(1)
            }.decodeList<NativeWorkerProfile>().firstOrNull()
            if (profile != null) {
                status = profile.status; city = profile.city; ward = profile.ward
                motivation = profile.motivation; available = profile.available; selectedSkills = profile.skills.toSet()
            } else status = ""
            if (profile?.status == "active") {
                assignments = client.from("work_assignments").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                    "id,status,due_at,worker_note,completion_note,created_at,report:reports(title,public_code,category,address_label)"
                )) {
                    filter { eq("worker_id", userId) }
                    order("created_at", Order.DESCENDING)
                    limit(30)
                }.decodeList<NativeWorkerAssignment>()
            } else assignments = emptyList()
        } catch (exception: Exception) {
            message = "Worker Hub could not load. Check your connection and the worker programme migration."
        } finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(17.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { FxHeader("Worker Hub", "Help with verified community tasks", Icons.Outlined.VolunteerActivism, onRefresh = { refresh++ }, loading = loading) }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = FxMint, trackColor = FxCard) }
            if (!loading && !enabled) item { FxEmptyCard("Worker programme paused", "New worker applications are temporarily unavailable. Please try again later.") }
            if (message.isNotBlank()) item { FxErrorCard(message) { refresh++ } }
            if (!loading && enabled && status != "active") {
                item {
                    Surface(color = FxSurface, shape = RoundedCornerShape(19.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            Text(if (status == "pending") "Application under review" else if (status == "rejected") "Update your application" else "Apply to become a community worker", color = FxText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            FxTextField(city, { city = it }, "City / town")
                            FxTextField(ward, { ward = it }, "Ward / local area")
                            FxTextField(motivation, { motivation = it.take(1000) }, "Why would you like to help?", minLines = 3)
                            Text("Choose your skills", color = FxMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            skills.forEach { skill ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = skill in selectedSkills, onCheckedChange = { on ->
                                        selectedSkills = if (on) selectedSkills + skill else selectedSkills - skill
                                    }, colors = CheckboxDefaults.colors(checkedColor = FxMint, checkmarkColor = FxNavy))
                                    Text(skill, color = FxText, fontSize = 12.sp)
                                }
                            }
                            Button(
                                onClick = {
                                    if (city.trim().length < 2 || ward.trim().isBlank()) { message = "Enter your city and ward."; return@Button }
                                    if (selectedSkills.isEmpty()) { message = "Select at least one skill."; return@Button }
                                    busy = true; message = ""
                                    scope.launch {
                                        try {
                                            val result = client.postgrest.rpc(
                                                function = "janwatch_worker_apply",
                                                parameters = buildJsonObject {
                                                    put("p_city", city.trim()); put("p_ward", ward.trim())
                                                    put("p_motivation", motivation.trim()); put("p_max_active_tasks", 3)
                                                    put("p_skills", buildJsonArray { selectedSkills.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                                                }
                                            )
                                            status = result.data.trim('"')
                                            message = if (status == "active") "Worker access is active." else "Application saved. You can check this page for its review status."
                                            refresh++
                                        } catch (exception: Exception) { message = "Application could not be saved. Review your details and retry." }
                                        finally { busy = false }
                                    }
                                },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)
                            ) {
                                if (busy) CircularProgressIndicator(Modifier.size(17.dp), color = FxNavy)
                                else Text("Submit worker application", fontWeight = FontWeight.Bold)
                            }
                            if (message.isNotBlank()) Text(message, color = FxMint, fontSize = 12.sp)
                            Text("Your application remains pending until it has been reviewed.", color = FxMuted, fontSize = 10.sp, lineHeight = 15.sp)
                        }
                    }
                }
            }
            if (status == "active") {
                item {
                    Surface(color = FxCard, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Approved worker", color = FxMint, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Text("Location: " + city + " · " + ward, color = FxMuted, fontSize = 12.sp)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Available for tasks", color = FxText, modifier = Modifier.weight(1f), fontSize = 13.sp)
                                Switch(checked = available, onCheckedChange = { next ->
                                    available = next
                                    scope.launch {
                                        try {
                                            client.postgrest.rpc(function = "janwatch_worker_set_availability", parameters = buildJsonObject { put("p_available", next) })
                                        } catch (_: Exception) { available = !next; message = "Availability was not changed. Please retry." }
                                    }
                                })
                            }
                        }
                    }
                }
                item { Text("Assigned tasks", color = FxText, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
                if (assignments.isEmpty()) item { FxEmptyCard("No assigned tasks", "New assignments will appear here when a task is assigned to you.") }
                items(assignments, key = { it.id }) { task ->
                    Surface(color = FxSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text(task.report?.title ?: "Civic report task", color = FxText, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text((task.report?.publicCode ?: "") + " · " + task.status.replace('_', ' '), color = FxMint, fontSize = 11.sp)
                            Text("Category: " + (task.report?.category ?: "Not provided"), color = FxMuted, fontSize = 11.sp)
                            if (!task.dueAt.isNullOrBlank()) Text("Due: " + fxDate(task.dueAt), color = FxMuted, fontSize = 11.sp)
                            if (task.status in listOf("assigned", "accepted", "in_progress", "changes_requested")) {
                                OutlinedButton(onClick = { activeTask = task; note = ""; message = "" }, modifier = Modifier.fillMaxWidth()) { Text("Update task", color = FxMint) }
                            }
                        }
                    }
                }
            }
        }
    }

    if (activeTask != null) {
        val task = activeTask!!
        val action = when (task.status) {
            "assigned" -> "accept"
            "accepted", "changes_requested" -> "start"
            "in_progress" -> "submit"
            else -> ""
        }
        AlertDialog(
            onDismissRequest = { if (!busy) activeTask = null },
            title = { Text(if (action == "submit") "Submit task for review" else if (action == "accept") "Accept this task" else "Start this task") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text("This updates the assigned-work workflow only. It does not change the official civic report's status.")
                    FxTextField(note, { note = it.take(2000) }, if (action == "submit") "Completion note (15+ characters if no evidence link)" else "Optional note", minLines = 3)
                    if (message.isNotBlank()) Text(message, color = FxRose, fontSize = 11.sp)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    busy = true
                    scope.launch {
                        try {
                            client.postgrest.rpc(
                                function = "janwatch_worker_update_assignment",
                                parameters = buildJsonObject {
                                    put("p_assignment_id", task.id); put("p_action", action); put("p_note", note.trim())
                                    put("p_evidence_urls", buildJsonArray { })
                                }
                            )
                            activeTask = null; message = "Task updated."; refresh++
                        } catch (_: Exception) { message = "Task update was rejected by the server. Check the task status and note."; }
                        finally { busy = false }
                    }
                }, enabled = !busy && action.isNotBlank()) { Text(if (busy) "Saving…" else "Confirm") }
            },
            dismissButton = { TextButton(onClick = { activeTask = null }) { Text("Cancel") } }
        )
    }
}

@Composable
fun NativeReferralScreen(client: SupabaseClient, userId: String) {
    val context = LocalContext.current
    var code by remember { mutableStateOf("") }
    var total by remember { mutableStateOf(0) }
    var qualified by remember { mutableStateOf(0) }
    var pending by remember { mutableStateOf(0) }
    var bonusPoints by remember { mutableStateOf(0) }
    var enabled by remember { mutableStateOf(false) }
    var history by remember { mutableStateOf<List<NativeReferralHistory>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Please sign in again." }
            val result = client.postgrest.rpc("janwatch_my_referral_summary")
            val obj = Json.parseToJsonElement(result.data).jsonObject
            code = obj["code"]?.jsonPrimitive?.content.orEmpty()
            total = obj["total"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            qualified = obj["qualified"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            pending = obj["pending"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            bonusPoints = obj["bonus_points"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            enabled = obj["enabled"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            history = obj["history"]?.jsonArray?.map { it.jsonObject }.orEmpty().map { row ->
                NativeReferralHistory(
                    status = row["status"]?.jsonPrimitive?.content.orEmpty(),
                    createdAt = row["created_at"]?.jsonPrimitive?.content.orEmpty(),
                    qualifiedAt = row["qualified_at"]?.jsonPrimitive?.content,
                    bonusAwarded = row["bonus_awarded"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
                )
            }
        } catch (_: Exception) { error = "Your referral summary couldn't load. Refresh and try again." }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(17.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { FxHeader("Refer & Earn", "Invite neighbours and track qualification", Icons.Outlined.GroupAdd, onRefresh = { refresh++ }, loading = loading) }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = FxMint, trackColor = FxCard) }
            if (error.isNotBlank()) item { FxErrorCard(error) { refresh++ } }
            if (!loading && error.isBlank()) {
                item {
                    Surface(color = FxMint, shape = RoundedCornerShape(21.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.background(Brush.linearGradient(listOf(Color(0xFFD7FFEA), FxMint))).padding(19.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("YOUR PERSONAL REFERRAL CODE", color = Color(0xFF245546), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                            Text(code.ifBlank { "Unavailable" }, color = Color(0xFF08251D), fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp)
                            Button(onClick = {
                                val share = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "Join LokPravaah with my referral code: " + code) }
                                try { context.startActivity(Intent.createChooser(share, "Share referral code")) } catch (_: Exception) { }
                            }, enabled = code.isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF092A22), contentColor = FxMint)) {
                                Icon(Icons.Outlined.Share, contentDescription = null)
                                Spacer(Modifier.width(5.dp))
                                Text("Share invite")
                            }
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FxMetric("Total", total.toString(), Modifier.weight(1f))
                        FxMetric("Qualified", qualified.toString(), Modifier.weight(1f))
                        FxMetric("Pending", pending.toString(), Modifier.weight(1f))
                    }
                }
                item {
                    FxEmptyCard(
                        if (enabled) "Bonus programme active" else "Bonus temporarily unavailable",
                        if (enabled) "The current configured bonus is $bonusPoints points per qualified referral. The server decides qualification and writes the reward ledger." else "Referral attribution may be recorded, but bonus awards are currently disabled by programme settings."
                    )
                }
                item { Text("Referral history", color = FxText, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
                if (history.isEmpty()) item { FxEmptyCard("No referrals yet", "Share your code. Only eligible, verified new accounts can qualify under programme rules.") }
                items(history) { row ->
                    Surface(color = FxSurface, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Outlined.GroupAdd, contentDescription = null, tint = FxMint)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(row.status.replaceFirstChar { it.uppercase() }, color = FxText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                Text(fxDate(row.createdAt), color = FxMuted, fontSize = 10.sp)
                            }
                            if (row.bonusAwarded) Text("Bonus awarded", color = FxMint, fontSize = 10.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun NativeDonateScreen(client: SupabaseClient, userId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var paymentBusy by remember { mutableStateOf(false) }
    var proofBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var paymentMessage by remember { mutableStateOf("") }
    var proofMessage by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(false) }
    var gatewayEnabled by remember { mutableStateOf(false) }
    var upiVpa by remember { mutableStateOf("") }
    var upiPayeeName by remember { mutableStateOf("LokPravaah") }
    // Save checkout UI across Activity recreation when the user returns from a UPI app.
    // Restoring this state is not proof of payment and never marks a donation successful.
    var activeUpiUri by rememberSaveable(userId) { mutableStateOf("") }
    var showProofForm by rememberSaveable(userId) { mutableStateOf(false) }
    var title by remember { mutableStateOf("Build a stronger civic community") }
    var description by remember { mutableStateOf("Your contribution helps keep LokPravaah available, accessible and improving.") }
    var goal by remember { mutableStateOf(0L) }
    var total by remember { mutableStateOf(0L) }
    var count by remember { mutableIntStateOf(0) }
    var minimumPaise by remember { mutableStateOf(100L) }
    var maximumPaise by remember { mutableStateOf(10_000_000L) }
    var suggested by remember { mutableStateOf(listOf(51, 101, 251, 501, 1001, 2100)) }
    var amountText by remember { mutableStateOf("251") }
    var donorName by remember { mutableStateOf(client.auth.currentUserOrNull()?.email?.substringBefore("@").orEmpty()) }
    var donorEmail by remember { mutableStateOf(client.auth.currentUserOrNull()?.email.orEmpty()) }
    var anonymous by remember { mutableStateOf(false) }
    var showOnLeaderboard by remember { mutableStateOf(false) }
    var showMessagePublicly by remember { mutableStateOf(false) }
    var donorMessage by remember { mutableStateOf("") }
    var activeOrderId by rememberSaveable(userId) { mutableStateOf("") }
    var activeAmountPaise by rememberSaveable(userId) { mutableStateOf(0L) }
    var claimedUtr by rememberSaveable(userId) { mutableStateOf("") }
    var claimedAmountText by rememberSaveable(userId) { mutableStateOf("") }
    var proofNote by remember { mutableStateOf("I completed the UPI transfer. Please check the transaction reference.") }
    var proofUri by remember { mutableStateOf<Uri?>(null) }
    var history by remember { mutableStateOf<List<NativeDonationHistoryRow>>(emptyList()) }
    var refresh by remember { mutableIntStateOf(0) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var leftAppWhileCheckoutVisible by remember(userId) { mutableStateOf(false) }

    // UPI apps often return to this Activity without recreating the Compose screen.
    // Refresh campaign totals and donation history when the app resumes after leaving it.
    DisposableEffect(lifecycleOwner, userId) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> leftAppWhileCheckoutVisible = true
                Lifecycle.Event.ON_RESUME -> if (leftAppWhileCheckoutVisible) {
                    leftAppWhileCheckoutVisible = false
                    refresh++
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val proofPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        proofUri = uri
        proofMessage = ""
    }

    LaunchedEffect(userId, refresh) {
        loading = true
        error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Please sign in again." }
            val result = client.postgrest.rpc("janwatch_get_public_donation_data")
            val obj = Json.parseToJsonElement(result.data).jsonObject
            val settings = obj["settings"]?.jsonObject
            enabled = settings?.get("donations_enabled")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            gatewayEnabled = settings?.get("payment_gateway_enabled")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            title = settings?.get("campaign_title")?.jsonPrimitive?.content ?: title
            description = settings?.get("campaign_description")?.jsonPrimitive?.content ?: description
            goal = settings?.get("campaign_goal_paise")?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
            total = obj["total_raised_paise"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
            count = obj["successful_donations"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            minimumPaise = settings?.get("min_amount_paise")?.jsonPrimitive?.content?.toLongOrNull() ?: 100L
            maximumPaise = settings?.get("max_amount_paise")?.jsonPrimitive?.content?.toLongOrNull() ?: 10_000_000L
            val currentSuggested = settings?.get("suggested_amounts")?.jsonArray?.mapNotNull {
                it.jsonPrimitive.content.toIntOrNull()
            }?.filter { it > 0 } ?: suggested
            suggested = currentSuggested
            if (refresh == 0 || amountText == "251") amountText = currentSuggested.firstOrNull()?.toString() ?: "251"
            try {
                val configResponse = client.postgrest.rpc("janwatch_get_public_donation_checkout_config")
                val config = Json.parseToJsonElement(configResponse.data).jsonObject
                upiVpa = config["upi_vpa"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                upiPayeeName = config["upi_payee_name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifBlank { "LokPravaah" }
                val configMin = config["min_amount_paise"]?.jsonPrimitive?.content?.toLongOrNull()
                val configMax = config["max_amount_paise"]?.jsonPrimitive?.content?.toLongOrNull()
                if (configMin != null) minimumPaise = configMin
                if (configMax != null) maximumPaise = configMax
            } catch (_: Exception) {
                upiVpa = ""
            }
        } catch (_: Exception) {
            error = "Campaign information is temporarily unavailable. Check your connection and try again."
        } finally {
            loading = false
        }

        try {
            val response = client.postgrest.rpc("janwatch_get_my_donations")
            val parsed = Json.decodeFromString<NativeDonationHistoryEnvelope>(response.data)
            history = parsed.donations
        } catch (_: Exception) {
            history = emptyList()
        }
    }

    val raised = total / 100.0
    val goalInRupees = goal / 100.0
    val progress = if (goal > 0L) (total.toDouble() / goal.toDouble()).coerceIn(0.0, 1.0).toFloat() else 0f
    val amountTextValid = Regex("^\\d+(?:\\.\\d{0,2})?$").matches(amountText.trim())
    val amountRupees = amountText.trim().toDoubleOrNull()
    val amountPaise = if (amountTextValid) amountRupees?.let { Math.round(it * 100.0) } else null
    val upiConfigured = Regex("^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$").matches(upiVpa)
    val donorEmailValid = donorEmail.isBlank() || Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(donorEmail.trim())
    val upiQrBitmap = remember(activeUpiUri) { activeUpiUri.takeIf { it.isNotBlank() }?.let { createNativeUpiQrBitmap(it) } }
    val mayCheckout = !loading && !paymentBusy && enabled && gatewayEnabled && upiConfigured &&
        amountPaise != null && amountPaise in minimumPaise..maximumPaise && donorEmailValid &&
        client.auth.currentUserOrNull()?.id == userId

    Column(Modifier.fillMaxSize().background(FxNavy)) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(17.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                FxHeader(
                    "Support LokPravaah",
                    "Campaign totals and your contributions",
                    Icons.Outlined.Favorite,
                    onRefresh = { refresh++ },
                    loading = loading
                )
            }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = FxMint, trackColor = FxCard) }
            if (error.isNotBlank()) item { FxErrorCard(error) { refresh++ } }

            if (!loading && error.isBlank()) {
                item {
                    Surface(color = FxMint, shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.background(Brush.linearGradient(listOf(Color(0xFFD7FFEA), FxMint, Color(0xFF8FE5BF)))).padding(19.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text("COMMUNITY CAMPAIGN", color = Color(0xFF245546), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.3.sp)
                            Text(title, color = Color(0xFF08251D), fontSize = 23.sp, lineHeight = 28.sp, fontWeight = FontWeight.ExtraBold)
                            Text(description, color = Color(0xFF245546), fontSize = 12.sp, lineHeight = 18.sp)
                            Spacer(Modifier.height(4.dp))
                            Text("₹" + String.format(Locale.ROOT, "%.2f", raised) + " raised", color = Color(0xFF08251D), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth(), color = Color(0xFF0D5944), trackColor = Color(0xFF90D8B8))
                            Text(if (goalInRupees > 0) "Goal: ₹" + String.format(Locale.ROOT, "%.0f", goalInRupees) else "Campaign goal not set", color = Color(0xFF245546), fontSize = 11.sp)
                            Text(count.toString() + " verified contributions", color = Color(0xFF245546), fontSize = 11.sp)
                        }
                    }
                }
                item {
                    Surface(color = FxSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Make a contribution", color = FxText, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                            Text("Select an amount or enter a custom contribution.", color = FxMuted, fontSize = 12.sp)
                            Text("₹" + amountText.ifBlank { "0" }, color = FxMint, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                                suggested.take(4).forEach { rupees ->
                                    Surface(
                                        color = if (amountText == rupees.toString()) FxMint else FxCard,
                                        shape = RoundedCornerShape(11.dp),
                                        modifier = Modifier.weight(1f).clickable { amountText = rupees.toString(); paymentMessage = "" }
                                    ) {
                                        Text(
                                            "₹" + rupees,
                                            color = if (amountText == rupees.toString()) FxNavy else FxText,
                                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(vertical = 11.dp),
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                                        )
                                    }
                                }
                            }
                            FxTextField(
                                value = amountText,
                                onValueChange = { amountText = it.filter { ch -> ch.isDigit() || ch == '.' }.take(9); paymentMessage = "" },
                                label = "Custom amount (₹)",
                                numeric = true
                            )
                            if (!anonymous) {
                                FxTextField(donorName, { donorName = it.take(80) }, "Your name (optional)")
                                FxTextField(donorEmail, { donorEmail = it.take(254) }, "Email (optional)")
                                if (!donorEmailValid) Text("Enter a valid email or leave it blank.", color = FxRose, fontSize = 11.sp)
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Checkbox(checked = anonymous, onCheckedChange = {
                                    anonymous = it
                                    if (it) { showOnLeaderboard = false; showMessagePublicly = false }
                                }, colors = CheckboxDefaults.colors(checkedColor = FxMint, checkmarkColor = FxNavy))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text("Keep my contribution anonymous", color = FxText, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                    Text("Your name will not be shown in public supporter lists.", color = FxMuted, fontSize = 10.sp, lineHeight = 14.sp)
                                }
                            }
                            if (!anonymous) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Checkbox(checked = showOnLeaderboard, onCheckedChange = {
                                        showOnLeaderboard = it
                                        if (!it) showMessagePublicly = false
                                    }, colors = CheckboxDefaults.colors(checkedColor = FxMint, checkmarkColor = FxNavy))
                                    Text("Include me on the supporter list", color = FxText, fontSize = 12.sp)
                                }
                                FxTextField(donorMessage, { donorMessage = it.take(300) }, "Optional message (max 300 characters)", minLines = 2)
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Checkbox(
                                        checked = showMessagePublicly,
                                        onCheckedChange = { showMessagePublicly = it },
                                        enabled = showOnLeaderboard && donorMessage.isNotBlank(),
                                        colors = CheckboxDefaults.colors(checkedColor = FxMint, checkmarkColor = FxNavy)
                                    )
                                    Text("Show my message publicly", color = FxText, fontSize = 12.sp)
                                }
                            }
                            Text(
                                if (!enabled) "Contributions are temporarily paused. Please check back later."
                                else if (!gatewayEnabled || !upiConfigured) "UPI payments are temporarily unavailable. No payment has been started."
                                else "A UPI app can open for payment. Your contribution appears in campaign totals only after verification.",
                                color = FxMuted, fontSize = 11.sp, lineHeight = 17.sp
                            )
                            Button(
                                onClick = {
                                    val value = amountPaise
                                    if (value == null || value < minimumPaise || value > maximumPaise) {
                                        paymentMessage = "Enter an amount between ₹" + String.format(Locale.ROOT, "%.2f", minimumPaise / 100.0) +
                                            " and ₹" + String.format(Locale.ROOT, "%.2f", maximumPaise / 100.0) + "."
                                        return@Button
                                    }
                                    if (!donorEmailValid) {
                                        paymentMessage = "Enter a valid email address or leave it blank."
                                        return@Button
                                    }
                                    if (!enabled || !gatewayEnabled || !upiConfigured) {
                                        paymentMessage = "The receiving UPI details are temporarily unavailable. No payment was started."
                                        return@Button
                                    }
                                    if (client.auth.currentUserOrNull()?.id != userId) {
                                        paymentMessage = "Your session has expired. Sign in again before contributing."
                                        return@Button
                                    }

                                    paymentBusy = true
                                    paymentMessage = ""
                                    val orderId = nativeDonationOrderId()
                                    scope.launch {
                                        try {
                                            client.from("donation_intents").insert(
                                                NativeDonationIntentInsert(
                                                    orderId = orderId,
                                                    donorUserId = userId,
                                                    amountPaise = value,
                                                    donorName = if (anonymous) null else donorName.trim().takeIf { it.isNotBlank() },
                                                    donorEmail = if (anonymous) null else donorEmail.trim().takeIf { it.isNotBlank() },
                                                    isAnonymous = anonymous,
                                                    showOnLeaderboard = !anonymous && showOnLeaderboard,
                                                    showMessagePublicly = !anonymous && showOnLeaderboard && showMessagePublicly && donorMessage.isNotBlank(),
                                                    message = donorMessage.trim().takeIf { !anonymous && showOnLeaderboard && showMessagePublicly && it.isNotBlank() }
                                                )
                                            )
                                            val upiUri = buildNativeUpiUri(
                                                vpa = upiVpa,
                                                payeeName = upiPayeeName,
                                                amountPaise = value,
                                                orderId = orderId
                                            )
                                            activeOrderId = orderId
                                            activeAmountPaise = value
                                            activeUpiUri = upiUri
                                            showProofForm = false
                                            claimedAmountText = String.format(Locale.ROOT, "%.2f", value / 100.0)
                                            claimedUtr = ""
                                            proofUri = null
                                            paymentMessage = "Your UPI QR is ready below. Scan it using your UPI app, or tap Open UPI app. After payment, tap I paid to submit your UTR and receipt. Reference: " + orderId
                                            showProofForm = false
                                            refresh++
                                        } catch (exception: Exception) {
                                            paymentMessage = exception.message?.take(220)
                                                ?: "Checkout couldn't be started. No payment page was opened; please try again."
                                        } finally {
                                            paymentBusy = false
                                        }
                                    }
                                },
                                enabled = mayCheckout,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)
                            ) {
                                if (paymentBusy) CircularProgressIndicator(Modifier.size(18.dp), color = FxNavy)
                                else {
                                    Icon(Icons.Outlined.Lock, contentDescription = null)
                                    Spacer(Modifier.width(7.dp))
                                    Text("Generate UPI QR", fontWeight = FontWeight.Bold)
                                }
                            }
                            if (paymentMessage.isNotBlank()) {
                                Surface(
                                    color = if (paymentMessage.contains("opened", true)) Color(0xFF16382E) else FxCard,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(paymentMessage, Modifier.padding(12.dp), color = if (paymentMessage.contains("opened", true)) FxMint else FxMuted, fontSize = 11.sp, lineHeight = 17.sp)
                                }
                            }
                        }
                    }
                }

                if (activeOrderId.isNotBlank() && activeUpiUri.isNotBlank() && history.none { row ->
                    row.orderId == activeOrderId && (
                        row.status.equals("succeeded", ignoreCase = true) ||
                            row.claimStatus in listOf("pending_review", "confirmed", "rejected")
                    )
                }) {
                    item {
                        Surface(color = FxSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.fillMaxWidth().padding(16.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(9.dp)
                            ) {
                                Text("SCAN TO PAY", color = FxMint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                                if (upiQrBitmap != null) {
                                    Surface(color = Color.White, shape = RoundedCornerShape(12.dp), modifier = Modifier.size(250.dp)) {
                                        Image(
                                            bitmap = upiQrBitmap.asImageBitmap(),
                                            contentDescription = "UPI payment QR for LokPravaah",
                                            modifier = Modifier.fillMaxSize().padding(10.dp)
                                        )
                                    }
                                } else {
                                    Text("QR could not be generated. Use Open UPI app below.", color = FxAmber, fontSize = 12.sp)
                                }
                                Text(upiPayeeName, color = FxText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(upiVpa, color = FxMuted, fontSize = 12.sp)
                                Text("₹" + String.format(Locale.ROOT, "%.2f", activeAmountPaise / 100.0), color = FxMint, fontWeight = FontWeight.ExtraBold, fontSize = 25.sp)
                                Text("Reference: " + activeOrderId, color = FxMuted, fontSize = 10.sp)
                                Text(
                                    "Before approving, verify the payee and amount in your UPI app. Returning to this screen does not confirm a payment.",
                                    color = FxMuted, fontSize = 11.sp, lineHeight = 16.sp
                                )
                                Button(
                                    onClick = {
                                        try {
                                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW, Uri.parse(activeUpiUri)), "Pay with UPI"))
                                        } catch (_: Exception) {
                                            paymentMessage = "No UPI app could open the payment link. You can still scan the QR with a UPI app."
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)
                                ) {
                                    Icon(Icons.Outlined.AccountBalanceWallet, contentDescription = null)
                                    Spacer(Modifier.width(7.dp))
                                    Text("Open UPI app", fontWeight = FontWeight.Bold)
                                }
                                OutlinedButton(
                                    onClick = { showProofForm = !showProofForm; proofMessage = "" },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(Icons.Outlined.CheckCircle, contentDescription = null)
                                    Spacer(Modifier.width(7.dp))
                                    Text(if (showProofForm) "Hide payment confirmation" else "I paid — submit UTR")
                                }
                            }
                        }
                    }
                }

                if (activeOrderId.isNotBlank() && showProofForm) {
                    item {
                        Surface(color = FxSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                Text("Submit payment proof", color = FxText, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Text("Reference: " + activeOrderId, color = FxMint, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "Only submit this after your UPI app or bank confirms the transfer. A screenshot or UTR alone does not mark a contribution verified.",
                                    color = FxMuted, fontSize = 11.sp, lineHeight = 16.sp
                                )
                                FxTextField(claimedUtr, { claimedUtr = it.trimStart().take(80); proofMessage = "" }, "UPI transaction ID / UTR (6–80 characters)")
                                FxTextField(claimedAmountText, { claimedAmountText = it.filter { ch -> ch.isDigit() || ch == '.' }.take(12); proofMessage = "" }, "Amount actually paid (₹)", numeric = true)
                                FxTextField(proofNote, { proofNote = it.take(2000) }, "Additional details (optional)", minLines = 2)
                                OutlinedButton(
                                    onClick = { proofPicker.launch(arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf")) },
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = FxText)
                                ) {
                                    Icon(Icons.Outlined.AttachFile, contentDescription = null)
                                    Spacer(Modifier.width(7.dp))
                                    Text(proofUri?.lastPathSegment?.substringAfterLast('/') ?: "Choose receipt screenshot or PDF")
                                }
                                Button(
                                    onClick = {
                                        val uri = proofUri
                                        val utr = claimedUtr.trim()
                                        val actualAmount = claimedAmountText.trim().toDoubleOrNull()
                                        when {
                                            !Regex("^[A-Za-z0-9_-]{6,80}$").matches(utr) -> proofMessage = "Enter the actual 6–80 character UPI transaction reference."
                                            actualAmount == null || actualAmount < 1.0 || actualAmount > 100000.0 -> proofMessage = "Enter the amount shown in your bank/UPI app."
                                            uri == null -> proofMessage = "Attach the payment screenshot or PDF receipt."
                                            else -> {
                                                proofBusy = true
                                                proofMessage = ""
                                                scope.launch {
                                                    var uploadedPath: String? = null
                                                    try {
                                                        check(client.auth.currentUserOrNull()?.id == userId) { "Your session has expired. Sign in again." }
                                                        val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                                                        check(mimeType in setOf("image/jpeg", "image/png", "image/webp", "application/pdf")) {
                                                            "Use a JPG, PNG, WebP image or PDF receipt."
                                                        }
                                                        val fileName = queryDonationProofName(uri, context)
                                                        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(100).ifBlank { "payment-proof" }
                                                        val bytes = readNativeDonationProof(uri, context)
                                                        val filePath = userId + "/" + activeOrderId + "-" + UUID.randomUUID() + "-" + safeName
                                                        client.storage.from("donation-payment-evidence").upload(filePath, bytes) {
                                                            contentType = ContentType.parse(mimeType)
                                                            upsert = false
                                                        }
                                                        uploadedPath = filePath
                                                        val result = client.postgrest.rpc(
                                                            function = "janwatch_submit_manual_donation_claim",
                                                            parameters = buildJsonObject {
                                                                put("p_order_id", activeOrderId)
                                                                put("p_screenshot_path", filePath)
                                                                put("p_claimed_utr", utr)
                                                                put("p_claimed_amount_paise", (actualAmount * 100.0).toLong())
                                                                put("p_payment_timestamp", null as String?)
                                                                put("p_user_note", proofNote.trim().takeIf { it.isNotBlank() })
                                                            }
                                                        )
                                                        val returned = Json.parseToJsonElement(result.data).jsonObject
                                                        proofMessage = returned["message"]?.jsonPrimitive?.content
                                                            ?: "Receipt submitted for payment review. This does not mean payment has been verified."
                                                        activeOrderId = ""
                                                        activeUpiUri = ""
                                                        showProofForm = false
                                                        proofUri = null
                                                        claimedUtr = ""
                                                        refresh++
                                                    } catch (exception: Exception) {
                                                        proofMessage = exception.message?.take(220)
                                                            ?: "Receipt couldn't be submitted. Check your connection and try again."
                                                    } finally {
                                                        proofBusy = false
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    enabled = !proofBusy,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)
                                ) {
                                    if (proofBusy) CircularProgressIndicator(Modifier.size(18.dp), color = FxNavy)
                                    else Text("Submit UTR and receipt", fontWeight = FontWeight.Bold)
                                }
                                if (proofMessage.isNotBlank()) Text(proofMessage, color = FxMint, fontSize = 11.sp, lineHeight = 16.sp)
                            }
                        }
                    }
                }

                item {
                    Text("Your contributions", color = FxText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
                if (history.isEmpty()) {
                    item {
                        FxEmptyCard(
                            "No contributions yet",
                            "Start a contribution above. Saved references and payment-review statuses will appear here."
                        )
                    }
                } else {
                    items(history.take(20), key = { it.id }) { donation ->
                        Surface(color = FxSurface, shape = RoundedCornerShape(15.dp), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text("₹" + String.format(Locale.ROOT, "%.2f", donation.amountPaise / 100.0), color = FxText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                                        Text("Ref: " + donation.orderId, color = FxMuted, fontSize = 10.sp)
                                    }
                                    FxStatusPill(
                                        if (donation.status.equals("succeeded", true) || donation.claimStatus == "confirmed") "verified"
                                        else donation.claimStatus ?: donation.status
                                    )
                                }
                                Text(fxDate(donation.createdAt), color = FxMuted, fontSize = 10.sp)
                                when (donation.claimStatus) {
                                    "pending_review" -> Text("Receipt received and awaiting bank-record verification. Please do not pay again.", color = FxAmber, fontSize = 11.sp, lineHeight = 16.sp)
                                    "rejected" -> Text(
                                        "More information is needed: " + (donation.adminReviewNote ?: "Check the transaction reference and receipt."),
                                        color = FxRose, fontSize = 11.sp, lineHeight = 16.sp
                                    )
                                    "confirmed" -> Text("Payment verified. Thank you for supporting LokPravaah.", color = FxMint, fontSize = 11.sp)
                                }
                                if (!donation.status.equals("succeeded", true) &&
                                    donation.claimStatus != "confirmed" && donation.claimStatus != "pending_review"
                                ) {
                                    TextButton(
                                        onClick = {
                                            activeOrderId = donation.orderId
                                            activeAmountPaise = donation.amountPaise
                                            claimedUtr = donation.claimedUtr.orEmpty()
                                            claimedAmountText = String.format(Locale.ROOT, "%.2f", (donation.claimedAmountPaise ?: donation.amountPaise) / 100.0)
                                            proofUri = null
                                            proofMessage = ""
                                        },
                                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp)
                                    ) {
                                        Text("Submit payment proof", color = FxMint, fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    OutlinedButton(onClick = { refresh++ }, enabled = !loading && !paymentBusy && !proofBusy, modifier = Modifier.fillMaxWidth()) {
                        Text("Refresh campaign and payment status", color = FxText)
                    }
                }
            }
        }
    }
}

private fun buildNativeUpiUri(vpa: String, payeeName: String, amountPaise: Long, orderId: String): String {
    // UPI PSPs expect a numeric transaction reference (maximum 35 characters).
    // The internal order ID is human-readable and is not valid as a UPI transaction reference.
    val suffix = orderId.replace("-", "").takeLast(16)
    val transactionReference = runCatching {
        java.math.BigInteger(suffix, 16).toString()
    }.getOrElse {
        orderId.filter { it.isDigit() }.takeLast(35).ifBlank { System.currentTimeMillis().toString() }
    }
    return Uri.Builder()
        .scheme("upi")
        .authority("pay")
        .appendQueryParameter("pa", vpa)
        .appendQueryParameter("pn", payeeName)
        .appendQueryParameter("am", String.format(Locale.ROOT, "%.2f", amountPaise / 100.0))
        .appendQueryParameter("cu", "INR")
        .appendQueryParameter("tr", transactionReference)
        .appendQueryParameter("tn", ("LokPravaah " + orderId).take(50))
        .build()
        .toString()
        .replace("+", "%20")
}

private fun createNativeUpiQrBitmap(value: String): Bitmap? {
    return try {
        val hints = mapOf(
            EncodeHintType.MARGIN to 2,
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M
        )
        val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 640, 640, hints)
        val pixels = IntArray(matrix.width * matrix.height)
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                pixels[y * matrix.width + x] = if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            }
        }
        Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixels, 0, matrix.width, 0, 0, matrix.width, matrix.height)
        }
    } catch (_: Exception) {
        null
    }
}

private suspend fun createNativeDonationCheckout(
    apiUrl: String,
    portalUrl: String,
    merchantKey: String,
    orderId: String,
    amountRupees: Double,
    donorName: String,
    donorEmail: String?,
    anonymous: Boolean,
    donorMessage: String?,
    amountPaise: Long
): NativeGatewayCheckout = withContext(Dispatchers.IO) {
    val apiUri = Uri.parse(apiUrl)
    val portalUri = Uri.parse(portalUrl)
    check(apiUri.scheme == "https" && !apiUri.host.isNullOrBlank()) { "The secure payment service is unavailable." }
    check(portalUri.scheme == "https" && !portalUri.host.isNullOrBlank()) { "The secure payment portal is unavailable." }
    check(apiUri.host.equals(portalUri.host, ignoreCase = true)) {
        "The payment service configuration doesn't match the trusted checkout portal. No payment was started."
    }
    check(merchantKey.isNotBlank()) { "The secure payment service is not configured." }

    val body = JSONObject()
        .put("amount", amountRupees)
        .put("orderId", orderId)
        .put("currency", "INR")
        .put("description", "Voluntary contribution to support LokPravaah")
        .put(
            "metadata",
            JSONObject()
                .put("purpose", "lokpravaah_donation")
                .put("order_id", orderId)
                .put("amount_paise", amountPaise)
        )
    if (!anonymous) {
        val customer = JSONObject()
        if (donorName.isNotBlank()) customer.put("fullName", donorName.take(80))
        if (!donorEmail.isNullOrBlank()) customer.put("email", donorEmail.take(254))
        if (customer.length() > 0) body.put("customer", customer)
        if (!donorMessage.isNullOrBlank()) body.put("note", donorMessage.take(300))
    }

    val connection = (URL(apiUrl.trimEnd('/') + "/api/v1/payments").openConnection() as HttpURLConnection)
    try {
        connection.requestMethod = "POST"
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.instanceFollowRedirects = false
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("X-Merchant-Id", merchantKey)
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val responseCode = connection.responseCode
        val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
        val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val response = try { JSONObject(responseText) } catch (_: Exception) { JSONObject() }
        if (responseCode !in 200..299) {
            throw IOException("Secure checkout couldn't create a payment session. No payment was opened; please retry later.")
        }
        val paymentId = response.optString("paymentId")
        val checkoutUrl = response.optString("checkoutUrl")
        val checkoutUri = Uri.parse(checkoutUrl)
        check(paymentId.isNotBlank() && checkoutUrl.isNotBlank()) { "The payment service returned an incomplete checkout response." }
        check(checkoutUri.scheme == "https" && checkoutUri.host == portalUri.host) {
            "The payment service returned an untrusted checkout link. No payment was opened."
        }
        NativeGatewayCheckout(paymentId, checkoutUrl)
    } finally {
        connection.disconnect()
    }
}

private fun nativeDonationOrderId(): String {
    val timestamp = java.lang.Long.toString(System.currentTimeMillis(), 36).uppercase(Locale.ROOT)
    val random = UUID.randomUUID().toString().replace("-", "").take(16).uppercase(Locale.ROOT)
    return "LPDON-" + timestamp + "-" + random
}

private fun queryDonationProofName(uri: Uri, context: android.content.Context): String {
    var name = uri.lastPathSegment?.substringAfterLast('/') ?: "payment-proof"
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0) name = cursor.getString(index) ?: name
        }
    }
    return name
}

private suspend fun readNativeDonationProof(uri: Uri, context: android.content.Context): ByteArray = withContext(Dispatchers.IO) {
    val stream = context.contentResolver.openInputStream(uri) ?: throw IOException("The receipt file couldn't be opened.")
    stream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > 10 * 1024 * 1024) throw IOException("Receipt must be 10 MB or smaller.")
            output.write(buffer, 0, count)
        }
        if (total == 0) throw IOException("The receipt file is empty.")
        output.toByteArray()
    }
}

@Serializable
private data class NativeDonationIntentInsert(
    @SerialName("order_id") val orderId: String,
    @SerialName("donor_user_id") val donorUserId: String,
    @SerialName("amount_paise") val amountPaise: Long,
    val currency: String = "INR",
    @SerialName("donor_name") val donorName: String? = null,
    @SerialName("donor_email") val donorEmail: String? = null,
    @SerialName("is_anonymous") val isAnonymous: Boolean = false,
    @SerialName("show_on_leaderboard") val showOnLeaderboard: Boolean = false,
    @SerialName("show_message_publicly") val showMessagePublicly: Boolean = false,
    val message: String? = null,
    val status: String = "pending"
)

@Serializable
private data class NativeGatewayCheckout(val paymentId: String, val checkoutUrl: String)

@Serializable
private data class NativeDonationHistoryEnvelope(val donations: List<NativeDonationHistoryRow> = emptyList())

@Serializable
private data class NativeDonationHistoryRow(
    val id: String,
    @SerialName("order_id") val orderId: String,
    @SerialName("amount_paise") val amountPaise: Long,
    val currency: String = "INR",
    val status: String,
    @SerialName("is_anonymous") val isAnonymous: Boolean = false,
    @SerialName("donor_name") val donorName: String? = null,
    @SerialName("record_source") val recordSource: String? = null,
    val utr: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("verified_at") val verifiedAt: String? = null,
    @SerialName("claim_status") val claimStatus: String? = null,
    @SerialName("claimed_utr") val claimedUtr: String? = null,
    @SerialName("claimed_amount_paise") val claimedAmountPaise: Long? = null,
    @SerialName("admin_review_note") val adminReviewNote: String? = null,
    @SerialName("reviewed_at") val reviewedAt: String? = null,
    @SerialName("ticket_number") val ticketNumber: Long? = null,
    @SerialName("ticket_status") val ticketStatus: String? = null
)

@Composable
fun NativeSupportTicketsScreen(client: SupabaseClient, userId: String) {
    val scope = rememberCoroutineScope()
    var tickets by remember { mutableStateOf<List<NativeSupportTicket>>(emptyList()) }
    var categories by remember { mutableStateOf(NativeSupportCategories) }
    var selected by remember { mutableStateOf<NativeSupportTicket?>(null) }
    var thread by remember { mutableStateOf<List<NativeSupportMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("Donations & UPI") }
    var subcategory by remember { mutableStateOf("Paid but website not confirmed") }
    var subject by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf("") }
    var newTicket by remember { mutableStateOf(false) }
    var categoriesExpanded by remember { mutableStateOf(false) }
    var subcategoriesExpanded by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(userId, refresh) {
        loading = true; error = ""
        try {
            check(client.auth.currentUserOrNull()?.id == userId) { "Please sign in again." }
            tickets = client.from("support_tickets").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                "id,ticket_number,user_id,category,subcategory,subject,description,status,priority,created_at,updated_at,resolution_note"
            )) {
                filter { eq("user_id", userId) }
                order("created_at", Order.DESCENDING)
                limit(100)
            }.decodeList<NativeSupportTicket>()
            try {
                categories = client.from("support_ticket_categories").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("category,subcategory")) {
                    filter { eq("active", true) }
                    order("sort_order", Order.ASCENDING)
                    limit(100)
                }.decodeList<NativeSupportCategory>().map { it.category to it.subcategory }
                    .ifEmpty { NativeSupportCategories }
            } catch (_: Exception) { categories = NativeSupportCategories }
        } catch (_: Exception) { error = "Support tickets couldn't load. Refresh and try again." }
        finally { loading = false }
    }

    LaunchedEffect(selected?.id) {
        val ticket = selected ?: return@LaunchedEffect
        try {
            thread = client.from("support_ticket_messages").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                "id,ticket_id,sender_id,message,is_internal_note,created_at"
            )) {
                filter { eq("ticket_id", ticket.id); eq("is_internal_note", false) }
                order("created_at", Order.ASCENDING)
                limit(200)
            }.decodeList<NativeSupportMessage>()
        } catch (_: Exception) { message = "This ticket's conversation couldn't load." }
    }

    Column(Modifier.fillMaxSize().background(FxNavy)) {
        if (selected != null) {
            val ticket = selected!!
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { selected = null; thread = emptyList(); reply = ""; message = "" }) { Text("← Tickets", color = FxMint) }
                    Column(Modifier.weight(1f)) {
                        Text("Ticket #" + ticket.ticketNumber, color = FxText, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                        Text(ticket.subject, color = FxMuted, fontSize = 11.sp)
                    }
                }
                FxStatusPill(ticket.status)
                if (!ticket.resolutionNote.isNullOrBlank()) Text("Resolution note: " + ticket.resolutionNote, color = FxMuted, fontSize = 11.sp)
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (thread.isEmpty()) item { FxEmptyCard("No replies yet", "Our support team will respond here.") }
                    items(thread, key = { it.id }) { row ->
                        val own = row.senderId == userId
                        Surface(color = if (own) Color(0xFF14354A) else FxSurface, shape = RoundedCornerShape(15.dp), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(if (own) "You" else "Support team", color = if (own) FxBlue else FxMint, fontWeight = FontWeight.Bold, fontSize = 10.sp)
                                Text(row.message, color = FxText, fontSize = 12.sp, lineHeight = 18.sp)
                                Text(fxDate(row.createdAt), color = FxMuted, fontSize = 9.sp)
                            }
                        }
                    }
                }
                FxTextField(reply, { reply = it.take(8000) }, "Write a reply", minLines = 2)
                Button(onClick = {
                    if (reply.trim().isBlank()) return@Button
                    busy = true; message = ""
                    scope.launch {
                        try {
                            client.from("support_ticket_messages").insert(NativeSupportMessageInsert(ticket.id, userId, reply.trim()))
                            reply = ""
                            selected = null
                            refresh++
                            message = "Reply sent."
                        } catch (_: Exception) { message = "Reply couldn't be sent. The ticket may be closed or permissions may have changed." }
                        finally { busy = false }
                    }
                }, enabled = !busy && reply.trim().isNotBlank(), modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)) {
                    Text(if (busy) "Sending…" else "Send reply")
                }
                if (message.isNotBlank()) Text(message, color = FxMuted, fontSize = 11.sp)
            }
        } else if (newTicket) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                TextButton(onClick = { newTicket = false; error = ""; message = "" }) { Text("← Back to tickets", color = FxMint) }
                Text("Create support ticket", color = FxText, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                Text("Select the closest topic and provide enough detail for support to investigate.", color = FxMuted, fontSize = 12.sp, lineHeight = 17.sp)
                Surface(color = FxSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { categoriesExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                            Text(category, color = FxText, modifier = Modifier.weight(1f)); Text("⌄", color = FxMint)
                        }
                        DropdownMenu(expanded = categoriesExpanded, onDismissRequest = { categoriesExpanded = false }) {
                            categories.map { it.first }.distinct().forEach { item ->
                                DropdownMenuItem(text = { Text(item) }, onClick = {
                                    category = item
                                    subcategory = categories.firstOrNull { it.first == item }?.second.orEmpty()
                                    categoriesExpanded = false
                                })
                            }
                        }
                        OutlinedButton(onClick = { subcategoriesExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                            Text(subcategory, color = FxText, modifier = Modifier.weight(1f)); Text("⌄", color = FxMint)
                        }
                        DropdownMenu(expanded = subcategoriesExpanded, onDismissRequest = { subcategoriesExpanded = false }) {
                            categories.filter { it.first == category }.forEach { item ->
                                DropdownMenuItem(text = { Text(item.second) }, onClick = { subcategory = item.second; subcategoriesExpanded = false })
                            }
                        }
                        FxTextField(subject, { subject = it.take(160) }, "Subject (4–160 characters)")
                        FxTextField(description, { description = it.take(8000) }, "Describe the issue (10–8000 characters)", minLines = 5)
                        Button(onClick = {
                            if (subject.trim().length !in 4..160 || description.trim().length !in 10..8000) {
                                error = "Enter a subject (4–160 chars) and description (10–8,000 chars)."
                                return@Button
                            }
                            busy = true; error = ""
                            scope.launch {
                                try {
                                    val created = client.from("support_tickets").insert(
                                        NativeSupportTicketInsert(userId, category, subcategory, subject.trim(), description.trim())
                                    ).decodeSingle<NativeSupportTicket>()
                                    client.from("support_ticket_messages").insert(NativeSupportMessageInsert(created.id, userId, description.trim()))
                                    newTicket = false; subject = ""; description = ""; refresh++
                                    message = "Ticket #" + created.ticketNumber + " created."
                                } catch (_: Exception) { error = "Ticket could not be created. Confirm the support tables and permissions are enabled, then retry." }
                                finally { busy = false }
                            }
                        }, enabled = !busy, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)) {
                            Text(if (busy) "Creating…" else "Create ticket", fontWeight = FontWeight.Bold)
                        }
                        if (error.isNotBlank()) Text(error, color = FxRose, fontSize = 12.sp)
                    }
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                item { FxHeader("Support tickets", "Help for accounts, reports, payments and rewards", Icons.Outlined.SupportAgent, onRefresh = { refresh++ }, loading = loading) }
                item {
                    Button(onClick = { newTicket = true; error = ""; message = "" }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = FxMint, contentColor = FxNavy)) {
                        Icon(Icons.Outlined.Add, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Create support ticket", fontWeight = FontWeight.Bold)
                    }
                }
                if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = FxMint, trackColor = FxCard) }
                if (error.isNotBlank()) item { FxErrorCard(error) { refresh++ } }
                if (!loading && tickets.isEmpty()) item { FxEmptyCard("No support tickets", "Create a ticket for help with a report, account, payment or technical issue.") }
                items(tickets, key = { it.id }) { ticket ->
                    Surface(color = FxSurface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().clickable { selected = ticket; message = "" }) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("#" + ticket.ticketNumber + " · " + ticket.subject, color = FxText, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                                FxStatusPill(ticket.status)
                            }
                            Text(ticket.category + " · " + ticket.subcategory, color = FxMuted, fontSize = 10.sp)
                            Text("Updated " + fxDate(ticket.updatedAt), color = FxMuted, fontSize = 10.sp)
                            Text("Open conversation →", color = FxMint, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (message.isNotBlank()) item { Text(message, color = FxMint, fontSize = 11.sp) }
            }
        }
    }
}

@Composable
private fun FxHeader(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onRefresh: (() -> Unit)? = null, loading: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        Surface(color = FxCard, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(46.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, tint = FxMint, modifier = Modifier.size(23.dp)) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, color = FxText, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
            Text(subtitle, color = FxMuted, fontSize = 11.sp, lineHeight = 15.sp)
        }
        if (onRefresh != null) IconButton(onClick = onRefresh, enabled = !loading) {
            Icon(Icons.Outlined.Refresh, contentDescription = "Refresh", tint = FxMint)
        }
    }
}

@Composable
private fun FxTextField(value: String, onValueChange: (String) -> Unit, label: String, minLines: Int = 1, numeric: Boolean = false) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), minLines = minLines, maxLines = if (minLines > 1) 7 else 1,
        keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = FxText, unfocusedTextColor = FxText,
            focusedContainerColor = Color(0xFF091827), unfocusedContainerColor = Color(0xFF091827),
            focusedBorderColor = FxMint, unfocusedBorderColor = FxLine,
            focusedLabelColor = FxMint, unfocusedLabelColor = FxMuted,
            focusedPlaceholderColor = FxMuted, unfocusedPlaceholderColor = FxMuted,
            cursorColor = FxMint
        ),
        shape = RoundedCornerShape(13.dp)
    )
}

@Composable
private fun FxMetric(title: String, value: String, modifier: Modifier = Modifier) {
    Surface(color = FxSurface, shape = RoundedCornerShape(14.dp), modifier = modifier) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = FxMuted, fontSize = 10.sp)
            Text(value, color = FxText, fontSize = 21.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
private fun FxEmptyCard(title: String, body: String) {
    Surface(color = FxSurface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, color = FxText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text(body, color = FxMuted, fontSize = 12.sp, lineHeight = 17.sp)
        }
    }
}

@Composable
private fun FxErrorCard(text: String, onRetry: () -> Unit) {
    Surface(color = Color(0xFF39242D), shape = RoundedCornerShape(15.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(text, color = FxRose, fontSize = 12.sp, lineHeight = 17.sp)
            TextButton(onClick = onRetry) { Text("Try again", color = FxMint) }
        }
    }
}

@Composable
private fun FxStatusPill(status: String) {
    val color = when (status.lowercase()) {
        "resolved", "completed", "qualified", "paid" -> FxMint
        "in_progress", "under_review", "pending", "open", "waiting_for_user" -> FxAmber
        "rejected", "closed", "cancelled" -> FxRose
        else -> FxBlue
    }
    Surface(color = color.copy(alpha = 0.12f), shape = RoundedCornerShape(100.dp)) {
        Text(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, color = color, fontWeight = FontWeight.Bold, fontSize = 9.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
    }
}

private fun fxDate(raw: String?): String = try {
    DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(raw))
} catch (_: Exception) { "Date unavailable" }

@Serializable
private data class NativePublicReport(
    val id: String, @SerialName("public_code") val publicCode: String, val title: String,
    val description: String = "", val category: String = "", val status: String = "submitted",
    @SerialName("address_label") val addressLabel: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    val latitude: Double? = null, val longitude: Double? = null,
    val visibility: String = "public",
    val supportedByMe: Boolean = false
)

@Serializable
private data class NativeReportVote(
    @SerialName("report_id") val reportId: String,
    @SerialName("user_id") val userId: String
)

@Serializable
private data class NativeReportVoteInsert(
    @SerialName("report_id") val reportId: String,
    @SerialName("user_id") val userId: String
)

@Serializable
private data class NativeWorkerSetting(val enabled: Boolean = false)

@Serializable
private data class NativeWorkerProfile(
    @SerialName("user_id") val userId: String, val status: String = "pending", val city: String = "",
    val ward: String = "", val skills: List<String> = emptyList(), val motivation: String = "",
    val available: Boolean = true, @SerialName("created_at") val createdAt: String = ""
)

@Serializable
private data class NativeWorkerAssignment(
    val id: String, val status: String, @SerialName("due_at") val dueAt: String? = null,
    @SerialName("worker_note") val workerNote: String? = null,
    @SerialName("completion_note") val completionNote: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    val report: NativeWorkerReportSummary? = null
)

@Serializable
private data class NativeWorkerReportSummary(
    val title: String = "", @SerialName("public_code") val publicCode: String = "",
    val category: String = "", @SerialName("address_label") val addressLabel: String? = null
)

@Serializable
private data class NativeReferralHistory(
    val status: String, @SerialName("created_at") val createdAt: String,
    @SerialName("qualified_at") val qualifiedAt: String? = null,
    @SerialName("bonus_awarded") val bonusAwarded: Boolean = false
)

@Serializable
private data class NativeSupportCategory(val category: String, val subcategory: String)

@Serializable
private data class NativeSupportTicket(
    val id: String, @SerialName("ticket_number") val ticketNumber: Long,
    @SerialName("user_id") val userId: String, val category: String, val subcategory: String,
    val subject: String, val description: String = "", val status: String, val priority: String = "normal",
    @SerialName("created_at") val createdAt: String, @SerialName("updated_at") val updatedAt: String,
    @SerialName("resolution_note") val resolutionNote: String? = null
)

@Serializable
private data class NativeSupportTicketInsert(
    @SerialName("user_id") val userId: String, val category: String, val subcategory: String,
    val subject: String, val description: String, val status: String = "open", val priority: String = "normal"
)

@Serializable
private data class NativeSupportMessage(
    val id: String, @SerialName("ticket_id") val ticketId: String,
    @SerialName("sender_id") val senderId: String, val message: String,
    @SerialName("is_internal_note") val isInternalNote: Boolean = false,
    @SerialName("created_at") val createdAt: String
)

@Serializable
private data class NativeSupportMessageInsert(
    @SerialName("ticket_id") val ticketId: String, @SerialName("sender_id") val senderId: String,
    val message: String, @SerialName("is_internal_note") val isInternalNote: Boolean = false
)

private val NativeSupportCategories = listOf(
    "Donations & UPI" to "Paid but website not confirmed",
    "Donations & UPI" to "Payment pending / processing",
    "Donations & UPI" to "Payment failed but money debited",
    "Donations & UPI" to "Refund / duplicate payment",
    "Donations & UPI" to "QR / checkout not working",
    "Account & Login" to "Login / OTP issue",
    "Account & Login" to "Google sign-in issue",
    "Reports & Complaints" to "Submit or update a report",
    "Rewards & Withdrawals" to "Reward or withdrawal issue",
    "Website & Technical" to "Bug / broken page",
    "Website & Technical" to "Other technical issue",
    "Other" to "General question"
)
