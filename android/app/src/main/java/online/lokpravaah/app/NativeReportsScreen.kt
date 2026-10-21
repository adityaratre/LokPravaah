package online.lokpravaah.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.location.LocationListener
import android.os.Handler
import android.os.Looper
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.launch
import online.lokpravaah.app.data.NativePickedEvidence
import online.lokpravaah.app.data.NativeReport
import online.lokpravaah.app.data.NativeReportEvent
import online.lokpravaah.app.data.NativeReportsRepository
import online.lokpravaah.app.data.queryPickedEvidence
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ReportsNavy = Color(0xFF07111F)
private val ReportsPanel = Color(0xFF102239)
private val ReportsMint = Color(0xFFB6F4D7)
private val ReportsMuted = Color(0xFF9BB6D3)
private val ReportsLine = Color(0xFF28415A)

private enum class NativeReportsPage { LIST, CREATE, DETAIL }

@Composable
fun NativeReportsScreen(
    client: SupabaseClient,
    userId: String,
    onContentDepthChanged: (Boolean) -> Unit = {}
) {
    val context = LocalContext.current
    val repository = remember(client, context.contentResolver) {
        NativeReportsRepository(client, context.contentResolver)
    }
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf(NativeReportsPage.LIST) }
    var reports by remember { mutableStateOf<List<NativeReport>>(emptyList()) }
    var selectedReport by remember { mutableStateOf<NativeReport?>(null) }
    var reportEvents by remember { mutableStateOf<List<NativeReportEvent>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var detailLoading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var evidenceLoading by remember { mutableStateOf(false) }
    var refreshing by remember { mutableIntStateOf(0) }
    var errorMessage by remember { mutableStateOf("") }
    var formMessage by remember { mutableStateOf("") }
    var toast by remember { mutableStateOf("") }

    LaunchedEffect(page) {
        onContentDepthChanged(page != NativeReportsPage.LIST)
    }

    BackHandler(enabled = page != NativeReportsPage.LIST) {
        when (page) {
            NativeReportsPage.CREATE -> if (!saving) { page = NativeReportsPage.LIST; formMessage = "" }
            NativeReportsPage.DETAIL -> { page = NativeReportsPage.LIST; selectedReport = null; reportEvents = emptyList(); errorMessage = "" }
            NativeReportsPage.LIST -> Unit
        }
    }

    LaunchedEffect(userId, refreshing) {
        if (client.auth.currentUserOrNull()?.id != userId) {
            reports = emptyList()
            errorMessage = "Your session has expired. Please sign in again."
            loading = false
            return@LaunchedEffect
        }
        loading = true
        errorMessage = ""
        try {
            reports = repository.loadMyReports(userId)
            if (client.auth.currentUserOrNull()?.id != userId) {
                reports = emptyList()
                errorMessage = "Your session has expired. Please sign in again."
            }
        } catch (error: Exception) {
            clearSessionIfExpired(client, error)
            reports = emptyList()
            errorMessage = nativeReportError(error)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(selectedReport?.id, page, userId) {
        val chosen = selectedReport
        if (page != NativeReportsPage.DETAIL || chosen == null) return@LaunchedEffect
        detailLoading = true
        errorMessage = ""
        try {
            val report = repository.loadReportDetails(chosen.id, userId)
            val events = repository.loadReportEvents(chosen.id, userId)
            if (client.auth.currentUserOrNull()?.id == userId) {
                selectedReport = report
                reportEvents = events
            } else {
                selectedReport = null
                reportEvents = emptyList()
                errorMessage = "Your session has expired. Please sign in again."
            }
        } catch (error: Exception) {
            clearSessionIfExpired(client, error)
            errorMessage = nativeReportError(error)
        } finally {
            detailLoading = false
        }
    }

    when (page) {
        NativeReportsPage.LIST -> ReportListPage(
            reports = reports,
            loading = loading,
            error = errorMessage,
            toast = toast,
            onDismissToast = { toast = "" },
            onRefresh = { refreshing++ },
            onCreate = { formMessage = ""; errorMessage = ""; page = NativeReportsPage.CREATE },
            onOpen = { report -> selectedReport = report; reportEvents = emptyList(); errorMessage = ""; page = NativeReportsPage.DETAIL }
        )
        NativeReportsPage.CREATE -> ReportCreatePage(
            saving = saving,
            message = formMessage,
            onCancel = { if (!saving) { page = NativeReportsPage.LIST; formMessage = "" } },
            onSubmit = { title, description, category, area, lat, lon, evidence ->
                saving = true
                formMessage = ""
                scope.launch {
                    try {
                        val created = repository.submitReport(userId, title, description, category, area, lat, lon, evidence)
                        if (client.auth.currentUserOrNull()?.id != userId) {
                            formMessage = "Your session expired before the screen could refresh. Sign in again to check your report."
                        } else {
                            reports = listOf(created) + reports.filterNot { it.id == created.id }
                            selectedReport = created
                            page = NativeReportsPage.LIST
                            refreshing++
                            toast = "Report submitted. Reference: " + created.publicCode
                        }
                    } catch (error: Exception) {
                        clearSessionIfExpired(client, error)
                        formMessage = nativeReportError(error)
                    } finally {
                        saving = false
                    }
                }
            }
        )
        NativeReportsPage.DETAIL -> ReportDetailPage(
            report = selectedReport,
            events = reportEvents,
            loading = detailLoading,
            error = errorMessage,
            evidenceLoading = evidenceLoading,
            onBack = { page = NativeReportsPage.LIST; selectedReport = null; reportEvents = emptyList(); errorMessage = "" },
            onOpenEvidence = {
                val report = selectedReport
                val path = report?.evidencePaths?.firstOrNull()
                if (report == null || path == null) {
                    toast = "This report has no attached evidence."
                } else {
                    evidenceLoading = true
                    scope.launch {
                        try {
                            val signedUrl = repository.signedEvidenceUrl(path, userId)
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(signedUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        } catch (error: Exception) {
                            clearSessionIfExpired(client, error)
                            toast = nativeReportError(error)
                        } finally { evidenceLoading = false }
                    }
                }
            },
            toast = toast,
            onDismissToast = { toast = "" }
        )
    }
}

@Composable
private fun ReportListPage(
    reports: List<NativeReport>,
    loading: Boolean,
    error: String,
    toast: String,
    onDismissToast: () -> Unit,
    onRefresh: () -> Unit,
    onCreate: () -> Unit,
    onOpen: (NativeReport) -> Unit
) {
    Column(Modifier.fillMaxSize().background(ReportsNavy).padding(horizontal = 18.dp, vertical = 14.dp)) {
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text("My reports", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                Text("Track the issues you have submitted.", color = ReportsMuted, fontSize = 12.sp)
            }
            TextButton(onClick = onRefresh, enabled = !loading) { Text("Refresh", color = ReportsMint) }
        }
        Spacer(Modifier.height(12.dp))
        Button(onClick = onCreate, enabled = !loading, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = ReportsMint, contentColor = ReportsNavy)) {
            Text("＋  Submit a report", fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))

        if (toast.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Surface(color = Color(0xFF183B35), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(toast, color = ReportsMint, modifier = Modifier.weight(1f), fontSize = 12.sp)
                    TextButton(onClick = onDismissToast) { Text("OK", color = ReportsMint) }
                }
            }
        }
        if (loading) {
            Box(Modifier.fillMaxWidth().padding(25.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ReportsMint)
            }
        }
        if (error.isNotBlank()) {
            Surface(color = Color(0xFF39222B), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Column(Modifier.padding(14.dp)) {
                    Text(error, color = Color(0xFFFFCDD2), fontSize = 13.sp)
                    TextButton(onClick = onRefresh) { Text("Try again", color = ReportsMint) }
                }
            }
        }
        if (!loading && error.isBlank() && reports.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("No reports yet", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                Spacer(Modifier.height(6.dp))
                Text("Your submitted civic issues will appear here.", color = ReportsMuted, fontSize = 13.sp)
                Spacer(Modifier.height(14.dp))
                TextButton(onClick = onCreate) { Text("Create your first report", color = ReportsMint) }
            }
        } else {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(top = 10.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(reports, key = { it.id }) { report ->
                    Surface(color = ReportsPanel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().clickable { onOpen(report) }) {
                        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.Top) {
                                Text(report.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                                StatusPill(report.status)
                            }
                            Text(report.publicCode.ifBlank { "Reference pending" }, color = ReportsMint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(report.category, color = ReportsMuted, fontSize = 12.sp)
                            Text(report.addressLabel.orEmpty().ifBlank { "Location not recorded" }, color = ReportsMuted, fontSize = 12.sp)
                            Text(formatNativeDate(report.createdAt), color = ReportsMuted, fontSize = 11.sp)
                            if (report.evidencePaths.isNotEmpty()) Text("Evidence attached", color = ReportsMint, fontSize = 11.sp)
                            Text("View details  →", color = ReportsMint, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportCreatePage(
    saving: Boolean,
    message: String,
    onCancel: () -> Unit,
    onSubmit: (String, String, String, String, Double?, Double?, NativePickedEvidence?) -> Unit
) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(NativeReportsRepository.REPORT_CATEGORIES.first()) }
    var categoryMenu by remember { mutableStateOf(false) }
    var area by remember { mutableStateOf("") }
    var latitude by remember { mutableStateOf("") }
    var longitude by remember { mutableStateOf("") }
    var evidence by remember { mutableStateOf<NativePickedEvidence?>(null) }
    var pickerMessage by remember { mutableStateOf("") }
    fun fillCurrentLocation() {
        try {
            val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            val lastKnown = providers.asSequence().mapNotNull { provider ->
                try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null } catch (_: IllegalArgumentException) { null }
            }.maxByOrNull { it.time }
            // Use a recent cached fix immediately, but request a fresh fix rather than
            // silently attaching an old location to a new civic report.
            if (lastKnown != null && System.currentTimeMillis() - lastKnown.time < 2 * 60 * 1000L) {
                latitude = lastKnown.latitude.toString()
                longitude = lastKnown.longitude.toString()
                pickerMessage = "Recent location filled. Check the pin before submitting."
                return
            }

            val activeProviders = providers.filter { provider ->
                try { manager.isProviderEnabled(provider) } catch (_: Exception) { false }
            }
            if (activeProviders.isEmpty()) {
                pickerMessage = "Turn on device location, or retry location capture."
                return
            }

            pickerMessage = "Getting your current location…"
            val handler = Handler(Looper.getMainLooper())
            var completed = false
            lateinit var listener: LocationListener
            fun finish(message: String) {
                if (completed) return
                completed = true
                try { manager.removeUpdates(listener) } catch (_: Exception) { }
                handler.removeCallbacksAndMessages(null)
                pickerMessage = message
            }
            listener = object : LocationListener {
                override fun onLocationChanged(location: android.location.Location) {
                    if (location.latitude.isFinite() && location.longitude.isFinite() &&
                        location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0) {
                        latitude = location.latitude.toString()
                        longitude = location.longitude.toString()
                        finish("Current location filled. Check the pin before submitting.")
                    }
                }
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
                @Deprecated("Deprecated in Android")
                override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
            }
            try {
                activeProviders.forEach { provider ->
                    manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
                }
                handler.postDelayed({
                    finish("Could not get a fresh fix in time. Move outdoors and retry.")
                }, 12_000L)
            } catch (_: SecurityException) {
                finish("Location permission is unavailable. Enable it in App settings and retry.")
            }
        } catch (_: Exception) {
            pickerMessage = "Could not read your location. Enable location access and retry."
        }
    }
    val requestLocationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true) fillCurrentLocation()
        else pickerMessage = "Location permission was denied. Enable it in App settings to submit a report."
    }
    LaunchedEffect(Unit) {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fine || coarse) fillCurrentLocation()
        else requestLocationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    val pickEvidence = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            try {
                val selected = queryPickedEvidence(context.contentResolver, uri)
                if (selected.mimeType !in NativeReportsRepository.ALLOWED_EVIDENCE_TYPES) {
                    evidence = null
                    pickerMessage = "Choose a JPG, PNG, WEBP, MP4 or WEBM file."
                } else if (selected.sizeBytes != null && selected.sizeBytes > NativeReportsRepository.MAX_EVIDENCE_BYTES) {
                    evidence = null
                    pickerMessage = "Evidence file must be 50 MB or smaller."
                } else {
                    evidence = selected
                    pickerMessage = ""
                }
            } catch (error: Exception) {
                evidence = null
                pickerMessage = error.message ?: "Could not read that file."
            }
        }
    }

    Column(Modifier.fillMaxSize().background(ReportsNavy)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onCancel, enabled = !saving) { Text("← Back", color = ReportsMint) }
            Text("New report", color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 4.dp)) {
            Text("Report a civic issue", color = ReportsMint, fontSize = 23.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text("Use accurate details. Reports are saved to your existing LokPravaah account.", color = ReportsMuted, fontSize = 13.sp)
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(value = title, onValueChange = { title = it.take(160) }, label = { Text("What’s the issue?") }, placeholder = { Text("e.g. Broken streetlight near the park", color = Color(0xFF8199A4), fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !saving)
            Spacer(Modifier.height(12.dp))
            Box {
                OutlinedButton(onClick = { categoryMenu = true }, modifier = Modifier.fillMaxWidth(), enabled = !saving) {
                    Text(category, color = Color.White, modifier = Modifier.weight(1f))
                    Text("⌄", color = ReportsMint)
                }
                DropdownMenu(expanded = categoryMenu, onDismissRequest = { categoryMenu = false }, modifier = Modifier.background(ReportsPanel)) {
                    NativeReportsRepository.REPORT_CATEGORIES.forEach { choice ->
                        DropdownMenuItem(text = { Text(choice, color = Color.White) }, onClick = { category = choice; categoryMenu = false })
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = area, onValueChange = { area = it.take(300) }, label = { Text("Where is it?") }, placeholder = { Text("Area, street or landmark", color = Color(0xFF8199A4), fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !saving)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = ReportsPanel, shape = RoundedCornerShape(50.dp)) {
                    Text("Normal priority suggestion", color = ReportsMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp))
                }
                Text("Priority is only a suggestion. It is not an emergency assessment or an official risk rating.", color = ReportsMuted, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Text(
                if (latitude.isNotBlank() && longitude.isNotBlank()) "Device location captured · required for submission" else "Allow device location so the report is pinned to where you are. Coordinates are captured automatically, never typed manually.",
                color = if (latitude.isNotBlank() && longitude.isNotBlank()) ReportsMint else ReportsMuted,
                fontSize = 12.sp
            )
            val pinLat = latitude.toDoubleOrNull()
            val pinLon = longitude.toDoubleOrNull()
            if (pinLat != null && pinLon != null && pinLat in -90.0..90.0 && pinLon in -180.0..180.0) {
                Spacer(Modifier.height(10.dp))
                Text("Location pin preview", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(Modifier.height(6.dp))
                AndroidView(
                    modifier = Modifier.fillMaxWidth().height(190.dp).clip(RoundedCornerShape(16.dp)),
                    factory = { ctx ->
                        Configuration.getInstance().userAgentValue = ctx.packageName
                        MapView(ctx).apply {
                            setTileSource(TileSourceFactory.MAPNIK)
                            setMultiTouchControls(true)
                            controller.setZoom(16.0)
                            val point = GeoPoint(pinLat, pinLon)
                            controller.setCenter(point)
                            val draggablePin = Marker(this).apply {
                                position = point
                                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                                title = "Drag pin to exact issue location"
                                isDraggable = true
                                setOnMarkerDragListener(object : Marker.OnMarkerDragListener {
                                    override fun onMarkerDrag(marker: Marker) = Unit
                                    override fun onMarkerDragStart(marker: Marker) = Unit
                                    override fun onMarkerDragEnd(marker: Marker) {
                                        val selected = marker.position
                                        latitude = selected.latitude.toString()
                                        longitude = selected.longitude.toString()
                                        controller.animateTo(selected)
                                    }
                                })
                            }
                            overlays.add(draggablePin)
                        }
                    },
                    update = { map ->
                        val point = GeoPoint(pinLat, pinLon)
                        val marker = map.overlays.filterIsInstance<Marker>().firstOrNull()
                        if (marker == null) {
                            map.overlays.add(Marker(map).apply {
                                position = point
                                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                                title = "Drag pin to exact issue location"
                                isDraggable = true
                                setOnMarkerDragListener(object : Marker.OnMarkerDragListener {
                                    override fun onMarkerDrag(marker: Marker) = Unit
                                    override fun onMarkerDragStart(marker: Marker) = Unit
                                    override fun onMarkerDragEnd(marker: Marker) {
                                        val selected = marker.position
                                        latitude = selected.latitude.toString()
                                        longitude = selected.longitude.toString()
                                        map.controller.animateTo(selected)
                                    }
                                })
                            })
                            map.controller.setCenter(point)
                        } else if (kotlin.math.abs(marker.position.latitude - pinLat) > 0.000001 ||
                            kotlin.math.abs(marker.position.longitude - pinLon) > 0.000001) {
                            marker.position = point
                            map.controller.setCenter(point)
                        }
                        map.invalidate()
                    }
                )
                Text("Check that the pin marks the issue location before submitting.", color = ReportsMuted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    if (fine || coarse) fillCurrentLocation()
                    else requestLocationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !saving
            ) { Text("Use my current location", color = ReportsMint) }
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = description,
                onValueChange = { description = it.take(5000) },
                label = { Text("Additional details (optional)") },
                placeholder = { Text("What happened? When did you notice it? Avoid including private personal information.") },
                minLines = 3,
                maxLines = 6,
                modifier = Modifier.fillMaxWidth(),
                enabled = !saving
            )
            Spacer(Modifier.height(12.dp))
            Surface(color = ReportsPanel, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text("Evidence (optional)", color = Color.White, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(5.dp))
                    Text("JPG, PNG, WEBP, MP4 or WEBM · maximum 50 MB · stored privately", color = ReportsMuted, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { pickEvidence.launch(arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm")) }, enabled = !saving, modifier = Modifier.fillMaxWidth()) {
                        Text(if (evidence == null) "Choose evidence file" else "Choose a different file", color = Color.White)
                    }
                    if (evidence != null) Text(evidence!!.displayName + " · " + formatFileSize(evidence!!.sizeBytes), color = ReportsMint, fontSize = 12.sp)
                    if (pickerMessage.isNotBlank()) {
                        val isProblem = listOf("could not", "denied", "permission", "invalid", "turn on", "must be", "required", "choose a", "50 MB").any { pickerMessage.contains(it, ignoreCase = true) }
                        Surface(color = if (isProblem) Color(0xFF35252B) else Color(0xFF17352F), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                            Text(pickerMessage, color = if (isProblem) Color(0xFFFFCDD2) else ReportsMint, fontSize = 12.sp, modifier = Modifier.padding(10.dp))
                        }
                    }
                }
            }
            if (message.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Surface(color = Color(0xFF35252B), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(message, color = Color(0xFFFFCDD2), fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
            Spacer(Modifier.height(14.dp))
            Surface(color = ReportsPanel, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("✓", color = ReportsMint, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("This sends your report to LokPravaah, not directly to a government department. For emergencies, contact local emergency services.", color = ReportsMuted, fontSize = 12.sp, lineHeight = 17.sp)
                }
            }
            Spacer(Modifier.height(18.dp))
            Button(onClick = {
                val lat = latitude.toDoubleOrNull()
                val lon = longitude.toDoubleOrNull()
                when {
                    title.trim().length !in 6..160 -> pickerMessage = "Report title must be between 6 and 160 characters."
                    area.trim().length < 3 -> pickerMessage = "Enter an area, street or landmark."
                    lat == null || lon == null -> {
                        pickerMessage = "Current device location is required. Allow location access and tap Use my current location."
                        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        if (fine || coarse) fillCurrentLocation()
                        else requestLocationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                    lat !in -90.0..90.0 || lon !in -180.0..180.0 -> pickerMessage = "Device location is invalid. Capture your current location again."
                    else -> { pickerMessage = ""; onSubmit(title, description, category, area, lat, lon, evidence) }
                }
            }, modifier = Modifier.fillMaxWidth(), enabled = !saving, colors = ButtonDefaults.buttonColors(containerColor = ReportsMint, contentColor = ReportsNavy)) {
                if (saving) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = ReportsNavy)
                else Text("Submit report", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ReportDetailPage(
    report: NativeReport?,
    events: List<NativeReportEvent>,
    loading: Boolean,
    error: String,
    evidenceLoading: Boolean,
    onBack: () -> Unit,
    onOpenEvidence: () -> Unit,
    toast: String,
    onDismissToast: () -> Unit
) {
    Column(Modifier.fillMaxSize().background(ReportsNavy)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Reports", color = ReportsMint) }
            Text("Report details", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 21.sp)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 6.dp)) {
            if (loading) {
                Box(Modifier.fillMaxWidth().padding(30.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = ReportsMint) }
            }
            if (error.isNotBlank()) {
                Surface(color = Color(0xFF39222B), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(error, color = Color(0xFFFFCDD2), modifier = Modifier.padding(14.dp))
                }
            }
            if (report != null) {
                Text(report.publicCode.ifBlank { "Reference pending" }, color = ReportsMint, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                Text(report.title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 25.sp)
                Spacer(Modifier.height(10.dp))
                StatusPill(report.status)
                Spacer(Modifier.height(14.dp))
                Surface(color = ReportsPanel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        DetailLine("Category", report.category)
                        DetailLine("Location", report.addressLabel.orEmpty().ifBlank { "Not recorded" })
                        DetailLine("Submitted", formatNativeDate(report.createdAt))
                        DetailLine("Last updated", formatNativeDate(report.updatedAt))
                        DetailLine("Priority suggestion", report.suggestedSeverity.replaceFirstChar { it.uppercase() })
                        if (report.latitude != null && report.longitude != null) {
                            DetailLine("Coordinates", report.latitude.toString() + ", " + report.longitude.toString())
                        }
                    }
                }
                if (report.description.isNotBlank()) {
                    Spacer(Modifier.height(12.dp))
                    Surface(color = ReportsPanel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Description", color = ReportsMuted, fontSize = 12.sp)
                            Spacer(Modifier.height(5.dp))
                            Text(report.description, color = Color.White, lineHeight = 22.sp)
                        }
                    }
                }
                if (report.evidencePaths.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onOpenEvidence, enabled = !evidenceLoading, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A3048))) {
                        if (evidenceLoading) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = ReportsMint)
                        else Text("Open attached evidence", color = Color.White)
                    }
                    Text("A short-lived secure link is generated only when you open the private file.", color = ReportsMuted, fontSize = 11.sp)
                }
                Spacer(Modifier.height(22.dp))
                Text("Status timeline", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Spacer(Modifier.height(10.dp))
                TimelineItem(title = "Report submitted", note = "Your report was received by LokPravaah.", date = report.createdAt, last = events.isEmpty())
                events.forEachIndexed { index, event ->
                    TimelineItem(
                        title = event.eventType.replace('_', ' ').replaceFirstChar { it.uppercase() },
                        note = event.note.orEmpty().ifBlank { "Status update recorded." },
                        date = event.createdAt,
                        last = index == events.lastIndex
                    )
                }
                if (events.isEmpty()) {
                    Text("No additional status events have been recorded yet.", color = ReportsMuted, fontSize = 12.sp, modifier = Modifier.padding(start = 24.dp, top = 2.dp))
                }
            }
            if (toast.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(toast, color = Color(0xFFFFCDD2), modifier = Modifier.weight(1f), fontSize = 12.sp)
                    TextButton(onClick = onDismissToast) { Text("Dismiss", color = ReportsMint) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = ReportsMuted, fontSize = 11.sp)
        Text(value, color = Color.White, fontSize = 14.sp)
    }
}

@Composable
private fun TimelineItem(title: String, note: String, date: String, last: Boolean) {
    Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(14.dp)) {
            Surface(color = ReportsMint, shape = RoundedCornerShape(50), modifier = Modifier.size(11.dp)) {}
            if (!last) Spacer(Modifier.width(2.dp).height(52.dp).background(ReportsLine))
        }
        Column(Modifier.weight(1f).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title.ifBlank { "Status update" }, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text(note, color = ReportsMuted, fontSize = 12.sp, lineHeight = 18.sp)
            Text(formatNativeDate(date), color = ReportsMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun StatusPill(status: String) {
    val (label, color) = when (status.lowercase()) {
        "resolved" -> "Resolved" to Color(0xFF8EE6B5)
        "verified" -> "Verified" to Color(0xFF93C5FD)
        "in_progress" -> "In progress" to Color(0xFFFCD34D)
        "under_review" -> "Under review" to Color(0xFFFCD34D)
        "rejected" -> "Rejected" to Color(0xFFFFA5A5)
        else -> "Submitted" to ReportsMint
    }
    Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
        Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
    }
}

private fun formatNativeDate(value: String): String {
    return try {
        DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(value))
    } catch (_: Exception) {
        value.ifBlank { "Date unavailable" }
    }
}

private fun formatFileSize(size: Long?): String {
    if (size == null || size < 0) return "size checked on upload"
    if (size < 1024L) return size.toString() + " B"
    if (size < 1024L * 1024L) return (size / 1024L).toString() + " KB"
    return String.format("%.1f MB", size.toDouble() / (1024L * 1024L))
}

private suspend fun clearSessionIfExpired(client: SupabaseClient, error: Throwable) {
    val text = error.message.orEmpty().lowercase()
    val expired = text.contains("jwt expired") ||
        text.contains("token expired") ||
        text.contains("token has expired") ||
        text.contains("invalid jwt") ||
        text.contains("401 unauthorized") ||
        text.contains("status code: 401")
    if (expired) {
        try { client.auth.signOut() } catch (_: Exception) {
            // Preserve the original failure; auth state observer will handle local expiry when emitted.
        }
    }
}

private fun nativeReportError(error: Throwable): String {
    val raw = error.message.orEmpty()
    val lower = raw.lowercase()
    return when {
        lower.contains("session has expired") || lower.contains("not authenticated") || lower.contains("jwt") ->
            "Your session may have expired. Please sign in again and retry."
        lower.contains("row-level security") || lower.contains("permission denied") || lower.contains("403") ->
            "Supabase denied this action under the current account permissions. No security rules were bypassed."
        lower.contains("reporting") && lower.contains("disabled") ->
            "New report submissions are temporarily disabled by the administrator."
        lower.contains("evidence_upload") || lower.contains("evidence uploads") ->
            "Evidence upload is currently unavailable or disabled. Remove the file or try again later."
        lower.contains("50 mb") || lower.contains("must be between") || lower.contains("valid report category") || lower.contains("enter an area") || lower.contains("coordinates") || lower.contains("title") || lower.contains("description") ->
            raw
        else -> "The report action failed. Check your connection and current Supabase permissions, then retry."
    }
}