package online.lokpravaah.app

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import online.lokpravaah.app.data.NativeSupabaseConfig
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ContentNavy = Color(0xFF06111F)
private val ContentSurface = Color(0xFF0E1D30)
private val ContentCard = Color(0xFF11263B)
private val ContentMint = Color(0xFFB6F4D7)
private val ContentText = Color(0xFFF5F9FF)
private val ContentMuted = Color(0xFF9BB1C8)
private val ContentRose = Color(0xFFFFA9B2)

@Composable
fun NativeHowItWorksScreen(onOpenReports: () -> Unit, onOpenAi: () -> Unit) {
    Column(Modifier.fillMaxSize().background(ContentNavy)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            item { contentHeader("How LokPravaah works", "A native guide to civic action", Icons.Outlined.AutoAwesome) }
            item {
                Surface(color = ContentMint, shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(19.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Your voice. Your city. Your impact.", color = Color(0xFF08251D), fontWeight = FontWeight.ExtraBold, fontSize = 23.sp, lineHeight = 28.sp)
                        Text("Report a local issue, share clear evidence, and follow official status updates from the same account you use on the website.", color = Color(0xFF245546), fontSize = 13.sp, lineHeight = 20.sp)
                    }
                }
            }
            item { HowStep("01", "Report the issue", "Choose a category, describe what happened, add the location and attach relevant evidence.", Icons.Outlined.AddLocationAlt) }
            item { HowStep("02", "Track the timeline", "Follow status changes and available updates for reports linked to your account.", Icons.Outlined.Timeline) }
            item { HowStep("03", "Support your community", "Explore public reports, join community discussion, and use rewards tools when eligible.", Icons.Outlined.Groups) }
            item { HowStep("04", "Get help from AI", "Ask for general guidance, legal-rights information or help structuring a complaint. Verify important advice with official sources.", Icons.Outlined.AutoAwesome) }
            item {
                Button(onClick = onOpenReports, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = ContentMint, contentColor = ContentNavy)) {
                    Icon(Icons.Outlined.ReceiptLong, null); Spacer(Modifier.width(8.dp)); Text("Open my reports", fontWeight = FontWeight.Bold)
                }
            }
            item {
                OutlinedButton(onClick = onOpenAi, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = ContentText)) {
                    Icon(Icons.Outlined.AutoAwesome, null); Spacer(Modifier.width(8.dp)); Text("Ask LokPravaah AI")
                }
            }
            item { Text("The Android app uses the same secure backend as the website while keeping its own native interface.", color = ContentMuted, fontSize = 11.sp, lineHeight = 17.sp) }
        }
    }
}

@Composable
private fun HowStep(number: String, title: String, body: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Surface(color = ContentSurface, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(15.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Surface(color = ContentCard, shape = RoundedCornerShape(13.dp), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = ContentMint, modifier = Modifier.size(23.dp)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(number + "  " + title, color = ContentText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(body, color = ContentMuted, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
    }
}

@Composable
fun NativeBlogScreen(client: SupabaseClient) {
    val context = LocalContext.current
    var posts by remember { mutableStateOf<List<NativeSitePost>>(emptyList()) }
    var selectedPost by remember { mutableStateOf<NativeSitePost?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }

    BackHandler(enabled = selectedPost != null) { selectedPost = null }
    LaunchedEffect(refresh) {
        loading = true
        error = ""
        try {
            posts = client.from("site_posts").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                "id,slug,title,excerpt,body,post_type,link_url,published_at,created_at"
            )) {
                filter { eq("is_published", true) }
                order("published_at", Order.DESCENDING)
                limit(60)
            }.decodeList<NativeSitePost>()
        } catch (_: Exception) {
            error = "Updates couldn't be loaded. Check your connection and try again."
        } finally { loading = false }
    }

    val post = selectedPost
    if (post != null) {
        Column(Modifier.fillMaxSize().background(ContentNavy).padding(18.dp)) {
            TextButton(onClick = { selectedPost = null }, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Icon(Icons.Outlined.ArrowBack, null, tint = ContentMint); Spacer(Modifier.width(6.dp)); Text("All updates", color = ContentMint)
            }
            Spacer(Modifier.height(8.dp))
            Text(post.postType?.replace('_', ' ')?.uppercase().orEmpty().ifBlank { "LOKPRAVAAH UPDATE" }, color = ContentMint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
            Spacer(Modifier.height(8.dp))
            Text(post.title, color = ContentText, fontSize = 27.sp, lineHeight = 33.sp, fontWeight = FontWeight.ExtraBold)
            Text(post.publishedAt?.let(::contentDate) ?: "", color = ContentMuted, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp, bottom = 14.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!post.excerpt.isNullOrBlank()) item { Text(post.excerpt, color = ContentMint, fontSize = 15.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium) }
                if (!post.body.isNullOrBlank()) item { Text(post.body, color = ContentText, fontSize = 14.sp, lineHeight = 22.sp) }
                if (!post.linkUrl.isNullOrBlank()) item {
                    OutlinedButton(onClick = {
                        val uri = Uri.parse(post.linkUrl)
                        if (uri.scheme == "https") {
                            try { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { }
                        }
                    }, colors = ButtonDefaults.outlinedButtonColors(contentColor = ContentMint)) { Text("Open linked resource") }
                }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(ContentNavy)) {
        LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { contentHeader("Blog & updates", "Published news and community information", Icons.Outlined.Article) }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = ContentMint, trackColor = ContentCard) }
            if (error.isNotBlank()) item { ContentError(error) { refresh++ } }
            if (!loading && error.isBlank() && posts.isEmpty()) item { ContentEmpty("No updates published yet", "New posts from LokPravaah will appear here.") }
            items(posts, key = { it.id }) { entry ->
                Surface(color = ContentSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth().clickable { selectedPost = entry }) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(entry.postType?.replace('_', ' ')?.uppercase().orEmpty().ifBlank { "UPDATE" }, color = ContentMint, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.weight(1f))
                            Text(entry.publishedAt?.let(::contentDate) ?: "", color = ContentMuted, fontSize = 10.sp)
                        }
                        Text(entry.title, color = ContentText, fontSize = 17.sp, fontWeight = FontWeight.Bold, lineHeight = 23.sp)
                        if (!entry.excerpt.isNullOrBlank()) Text(entry.excerpt, color = ContentMuted, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
                        Text("Read update  →", color = ContentMint, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            item { OutlinedButton(onClick = { refresh++ }, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text("Refresh updates", color = ContentText) } }
        }
    }
}

@Composable
fun NativeDownloadsScreen(client: SupabaseClient) {
    val context = LocalContext.current
    var files by remember { mutableStateOf<List<NativeDownloadFile>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(refresh) {
        loading = true
        error = ""
        try {
            files = client.from("download_files").select(columns = io.github.jan.supabase.postgrest.query.Columns.raw(
                "id,title,description,file_name,storage_path,file_size,version,created_at"
            )) {
                filter { eq("is_published", true) }
                order("created_at", Order.DESCENDING)
                limit(100)
            }.decodeList<NativeDownloadFile>()
        } catch (_: Exception) {
            error = "Downloads couldn't be loaded. Check your connection and try again."
        } finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(ContentNavy)) {
        LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { contentHeader("Downloads", "Files published by LokPravaah", Icons.Outlined.Download) }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = ContentMint, trackColor = ContentCard) }
            if (error.isNotBlank()) item { ContentError(error) { refresh++ } }
            if (message.isNotBlank()) item {
                Surface(color = ContentCard, shape = RoundedCornerShape(12.dp)) { Text(message, Modifier.padding(12.dp), color = ContentMint, fontSize = 12.sp) }
            }
            if (!loading && error.isBlank() && files.isEmpty()) item { ContentEmpty("No files published yet", "Files made available by the LokPravaah team will be listed here.") }
            items(files, key = { it.id }) { file ->
                Surface(color = ContentSurface, shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(color = ContentCard, shape = RoundedCornerShape(13.dp), modifier = Modifier.size(44.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.InsertDriveFile, null, tint = ContentMint, modifier = Modifier.size(23.dp)) }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(file.title, color = ContentText, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            if (!file.description.isNullOrBlank()) Text(file.description, color = ContentMuted, fontSize = 11.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            val versionText = file.version?.takeIf { it.isNotBlank() }?.let { "v" + it }
                            Text(listOfNotNull(versionText, contentSize(file.fileSize)).joinToString(" · "), color = ContentMuted, fontSize = 10.sp)
                        }
                        IconButton(onClick = {
                            message = ""
                            try {
                                check(NativeSupabaseConfig.isConfigured) { "Downloads aren't configured in this build." }
                                val path = file.storagePath.split('/').joinToString("/") { Uri.encode(it) }
                                val url = NativeSupabaseConfig.projectUrl + "/storage/v1/object/public/app-downloads/" + path
                                val safeName = file.fileName.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_").take(140).ifBlank { "lokpravaah-download" }
                                val request = DownloadManager.Request(Uri.parse(url))
                                    .setTitle(file.title)
                                    .setDescription("Downloading from LokPravaah")
                                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName)
                                    .setAllowedOverMetered(true)
                                    .setAllowedOverRoaming(false)
                                val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                                manager.enqueue(request)
                                message = "Download started: " + safeName + ". Check the Android notification and Downloads folder."
                            } catch (exception: Exception) {
                                message = exception.message ?: "The download couldn't be started."
                            }
                        }) {
                            Icon(Icons.Outlined.FileDownload, contentDescription = "Download " + file.fileName, tint = ContentMint)
                        }
                    }
                }
            }
            item { OutlinedButton(onClick = { refresh++ }, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text("Refresh files", color = ContentText) } }
        }
    }
}

@Composable
private fun contentHeader(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(Modifier.fillMaxWidth().padding(bottom = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(color = ContentCard, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(48.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = ContentMint, modifier = Modifier.size(24.dp)) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, color = ContentText, fontSize = 23.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
            Text(subtitle, color = ContentMuted, fontSize = 11.sp, lineHeight = 15.sp)
        }
    }
}

@Composable
private fun ContentEmpty(title: String, detail: String) {
    Surface(color = ContentSurface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, color = ContentText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(detail, color = ContentMuted, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
private fun ContentError(message: String, onRetry: () -> Unit) {
    Surface(color = Color(0xFF34222B), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("Could not load content", color = ContentRose, fontWeight = FontWeight.Bold)
            Text(message, color = ContentMuted, fontSize = 12.sp, lineHeight = 18.sp)
            TextButton(onClick = onRetry) { Text("Try again", color = ContentMint) }
        }
    }
}

private fun contentDate(value: String): String = try {
    DateTimeFormatter.ofPattern("dd MMM yyyy").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
} catch (_: Exception) { "" }

private fun contentSize(bytes: Long): String = when {
    bytes < 1024 -> bytes.toString() + " B"
    bytes < 1024 * 1024 -> String.format(java.util.Locale.ROOT, "%.0f KB", bytes / 1024.0)
    else -> String.format(java.util.Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0))
}

@Serializable
private data class NativeSitePost(
    val id: String,
    val slug: String,
    val title: String,
    val excerpt: String? = null,
    val body: String? = null,
    @SerialName("post_type") val postType: String? = null,
    @SerialName("link_url") val linkUrl: String? = null,
    @SerialName("published_at") val publishedAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
private data class NativeDownloadFile(
    val id: String,
    val title: String,
    val description: String? = null,
    @SerialName("file_name") val fileName: String,
    @SerialName("storage_path") val storagePath: String,
    @SerialName("file_size") val fileSize: Long = 0,
    val version: String? = null,
    @SerialName("created_at") val createdAt: String? = null
)
