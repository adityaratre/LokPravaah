package online.lokpravaah.app.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.storage.storage
import io.ktor.http.ContentType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Serializable
data class NativeReport(
    val id: String = "",
    @SerialName("public_code") val publicCode: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "",
    val status: String = "submitted",
    @SerialName("suggested_severity") val suggestedSeverity: String = "normal",
    @SerialName("address_label") val addressLabel: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("reporter_id") val reporterId: String = "",
    val visibility: String = "public",
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerialName("evidence_paths") val evidencePaths: List<String> = emptyList()
)

@Serializable
data class NativeReportEvent(
    @SerialName("event_type") val eventType: String = "",
    val note: String? = null,
    @SerialName("created_at") val createdAt: String = ""
)

@Serializable
data class NativeReportInsert(
    @SerialName("reporter_id") val reporterId: String,
    val title: String,
    val description: String,
    val category: String,
    @SerialName("suggested_severity") val suggestedSeverity: String,
    @SerialName("address_label") val addressLabel: String,
    val visibility: String = "public",
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerialName("evidence_paths") val evidencePaths: List<String> = emptyList()
)

@Serializable
private data class NativeFeatureFlag(
    @SerialName("flag_key") val key: String,
    val enabled: Boolean
)

data class NativePickedEvidence(
    val uri: Uri,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long?
)

/**
 * Citizen report operations on the existing Supabase schema.
 * All reads/writes are scoped to the authenticated citizen and remain subject to RLS.
 */
class NativeReportsRepository(
    private val supabase: SupabaseClient,
    private val contentResolver: ContentResolver
) {
    suspend fun loadMyReports(reporterId: String): List<NativeReport> {
        requireCurrentUser(reporterId)
        return supabase.from("reports").select {
            filter { eq("reporter_id", reporterId) }
            order("created_at", Order.DESCENDING)
            limit(100)
        }.decodeList<NativeReport>()
    }

    suspend fun loadReportDetails(reportId: String, reporterId: String): NativeReport {
        requireCurrentUser(reporterId)
        return supabase.from("reports").select {
            filter {
                eq("id", reportId)
                eq("reporter_id", reporterId)
            }
            limit(1)
        }.decodeSingle<NativeReport>()
    }

    suspend fun loadReportEvents(reportId: String, reporterId: String): List<NativeReportEvent> {
        requireCurrentUser(reporterId)
        return supabase.from("report_events").select {
            filter { eq("report_id", reportId) }
            order("created_at", Order.ASCENDING)
            limit(100)
        }.decodeList<NativeReportEvent>()
    }

    suspend fun isFeatureEnabled(flagKey: String): Boolean {
        val flags = supabase.from("app_feature_flags").select {
            filter { eq("flag_key", flagKey) }
            limit(1)
        }.decodeList<NativeFeatureFlag>()
        return flags.firstOrNull()?.enabled ?: false
    }

    suspend fun submitReport(
        reporterId: String,
        title: String,
        description: String,
        category: String,
        addressLabel: String,
        latitude: Double?,
        longitude: Double?,
        evidence: NativePickedEvidence?
    ): NativeReport {
        requireCurrentUser(reporterId)
        val cleanTitle = title.trim()
        val cleanDescription = description.trim()
        val cleanArea = addressLabel.trim()
        require(cleanTitle.length in 6..160) { "Report title must be between 6 and 160 characters." }
        require(cleanDescription.length <= 5000) { "Description cannot exceed 5,000 characters." }
        require(category in REPORT_CATEGORIES) { "Choose a valid report category." }
        require(cleanArea.length >= 3) { "Enter an area, street or landmark." }
        require((latitude == null) == (longitude == null)) { "Enter both coordinates, or leave both empty." }
        require(latitude == null || latitude in -90.0..90.0) { "Latitude must be between -90 and 90." }
        require(longitude == null || longitude in -180.0..180.0) { "Longitude must be between -180 and 180." }

        check(isFeatureEnabled("reporting")) { "New report submissions are temporarily disabled." }
        var uploadedPath: String? = null
        try {
            if (evidence != null) {
                check(isFeatureEnabled("evidence_upload")) { "Evidence uploads are temporarily disabled." }
                validateEvidence(evidence)
                val safeName = evidence.displayName
                    .replace(Regex("[^A-Za-z0-9._-]"), "_")
                    .takeLast(90)
                    .ifBlank { "evidence" }
                val path = reporterId + "/" + UUID.randomUUID().toString() + "-" + safeName
                val bytes = withContext(Dispatchers.IO) { readBoundedBytes(evidence.uri) }
                supabase.storage.from(EVIDENCE_BUCKET).upload(path, bytes) {
                    contentType = ContentType.parse(evidence.mimeType)
                    upsert = false
                }
                uploadedPath = path
            }

            val payload = NativeReportInsert(
                reporterId = reporterId,
                title = cleanTitle,
                description = cleanDescription,
                category = category,
                suggestedSeverity = suggestSeverity(category, cleanTitle, cleanDescription),
                addressLabel = cleanArea,
                visibility = "public",
                latitude = latitude,
                longitude = longitude,
                evidencePaths = uploadedPath?.let { listOf(it) } ?: emptyList()
            )
            requireCurrentUser(reporterId)
            return supabase.from("reports").insert(payload).decodeSingle<NativeReport>()
        } catch (error: Exception) {
            if (uploadedPath != null) {
                try { supabase.storage.from(EVIDENCE_BUCKET).delete(uploadedPath) } catch (_: Exception) { /* best-effort cleanup */ }
            }
            throw error
        }
    }

    suspend fun signedEvidenceUrl(path: String, reporterId: String): String {
        requireCurrentUser(reporterId)
        check(path.startsWith(reporterId + "/")) { "You can only open evidence attached to your own reports." }
        return supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, expiresIn = kotlin.time.Duration.parse("5m"))
    }

    private fun requireCurrentUser(expectedId: String) {
        val currentId = supabase.auth.currentUserOrNull()?.id
        check(!currentId.isNullOrBlank() && currentId == expectedId) {
            "Your session has expired. Please sign in again."
        }
    }

    private fun validateEvidence(file: NativePickedEvidence) {
        require(file.mimeType in ALLOWED_EVIDENCE_TYPES) {
            "Evidence must be JPG, PNG, WEBP, MP4 or WEBM."
        }
        require(file.sizeBytes == null || file.sizeBytes in 1..MAX_EVIDENCE_BYTES) {
            "Evidence file must be 50 MB or smaller and cannot be empty."
        }
    }

    private fun readBoundedBytes(uri: Uri): ByteArray {
        val input = contentResolver.openInputStream(uri) ?: throw IOException("Could not read the selected evidence file.")
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_EVIDENCE_BYTES) throw IOException("Evidence file must be 50 MB or smaller.")
                output.write(buffer, 0, read)
            }
            if (total == 0L) throw IOException("The selected evidence file is empty.")
            return output.toByteArray()
        }
    }

    companion object {
        const val EVIDENCE_BUCKET = "citizen-evidence"
        const val MAX_EVIDENCE_BYTES = 50L * 1024L * 1024L
        val ALLOWED_EVIDENCE_TYPES = setOf("image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm")
        val REPORT_CATEGORIES = listOf(
            "Roads & Footpaths",
            "Waste & Sanitation",
            "Streetlights",
            "Water & Drainage",
            "Public Safety",
            "Parks & Public Spaces",
            "Other"
        )

        private fun suggestSeverity(category: String, title: String, description: String): String {
            val value = (category + " " + title + " " + description).lowercase()
            val urgentTerms = listOf("live wire", "exposed wire", "electric shock", "gas leak", "fire", "open manhole", "building collapse", "wall collapse", "fallen electric pole", "electrocution", "खुला बिजली तार", "बिजली का तार", "गैस लीक", "आग लग", "खुला मैनहोल", "इमारत गिर", "दीवार गिर", "करंट लग")
            val highTerms = listOf("severe flooding", "water entering homes", "road collapsed", "major pothole", "sewage overflow", "contaminated drinking water", "dangerous road", "accident risk", "flooding", "overflowing drain", "गंभीर जलभराव", "घर में पानी", "सड़क धंस", "बड़ा गड्ढा", "सीवेज", "दूषित पानी", "दुर्घटना", "नाली का पानी", "खतरनाक सड़क")
            return when {
                urgentTerms.any { value.contains(it) } -> "urgent"
                highTerms.any { value.contains(it) } -> "high"
                else -> "normal"
            }
        }
    }
}

fun queryPickedEvidence(contentResolver: ContentResolver, uri: Uri): NativePickedEvidence {
    val fallbackName = uri.lastPathSegment?.substringAfterLast('/') ?: "evidence"
    var displayName = fallbackName
    var size: Long? = null
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameColumn >= 0) displayName = cursor.getString(nameColumn) ?: fallbackName
            if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
        }
    }
    val mimeType = contentResolver.getType(uri) ?: when (displayName.substringAfterLast('.', "").lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "mp4" -> "video/mp4"
        "webm" -> "video/webm"
        else -> "application/octet-stream"
    }
    return NativePickedEvidence(uri, displayName, mimeType, size)
}
