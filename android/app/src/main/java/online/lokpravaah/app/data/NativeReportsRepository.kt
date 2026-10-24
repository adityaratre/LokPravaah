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
import java.time.Instant
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

    /** Recent public reports used only to warn citizens about possible duplicates before submission. */
    suspend fun loadRecentPublicReports(category: String): List<NativeReport> {
        requireCurrentUser(supabase.auth.currentUserOrNull()?.id ?: throw IllegalStateException("Please sign in again."))
        return supabase.from("reports").select {
            filter {
                eq("visibility", "public")
                eq("category", category)
            }
            order("created_at", Order.DESCENDING)
            limit(80)
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
        NativeReportRules.validateReport(cleanTitle, cleanDescription, category, cleanArea, latitude, longitude)

        check(isFeatureEnabled("reporting")) { "New report submissions are temporarily disabled." }
        var uploadedPath: String? = null
        var insertAttempted = false
        val submitStartedAt = Instant.now()
        try {
            if (evidence != null) {
                check(isFeatureEnabled("evidence_upload")) { "Evidence uploads are temporarily disabled." }
                NativeReportRules.validateEvidence(evidence.mimeType, evidence.sizeBytes)
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
                suggestedSeverity = NativeReportRules.suggestSeverity(category, cleanTitle, cleanDescription),
                addressLabel = cleanArea,
                visibility = "public",
                latitude = latitude,
                longitude = longitude,
                evidencePaths = uploadedPath?.let { listOf(it) } ?: emptyList()
            )
            requireCurrentUser(reporterId)
            // Do not depend on PostgREST returning a decodable row in the INSERT response.
            // Some deployments commit the row but fail while decoding the response, which
            // leaves the citizen seeing an error even though the website/admin already has it.
            insertAttempted = true
            supabase.from("reports").insert(payload)
            return findJustSubmittedReport(
                reporterId = reporterId,
                title = cleanTitle,
                description = cleanDescription,
                category = category,
                startedAt = submitStartedAt
            ) ?: throw IOException("Your report may have been saved, but the app could not reload it. Open My reports and refresh before submitting again.")
        } catch (error: Exception) {
            // Recover a report that was committed server-side if the response was lost or
            // the follow-up request failed transiently. This prevents duplicate submissions.
            if (insertAttempted) {
                try {
                    val recovered = findJustSubmittedReport(
                        reporterId = reporterId,
                        title = cleanTitle,
                        description = cleanDescription,
                        category = category,
                        startedAt = submitStartedAt
                    )
                    if (recovered != null) return recovered
                } catch (_: Exception) {
                    // Preserve the original failure for the UI's diagnostics.
                }
            } else if (uploadedPath != null) {
                try { supabase.storage.from(EVIDENCE_BUCKET).delete(uploadedPath) } catch (_: Exception) { /* best-effort cleanup */ }
            }
            throw error
        }
    }

    private suspend fun findJustSubmittedReport(
        reporterId: String,
        title: String,
        description: String,
        category: String,
        startedAt: Instant
    ): NativeReport? {
        requireCurrentUser(reporterId)
        return loadMyReports(reporterId)
            .asSequence()
            .filter { it.title.trim() == title && it.description.trim() == description && it.category == category }
            .filter {
                try {
                    Instant.parse(it.createdAt).isAfter(startedAt.minusSeconds(15))
                } catch (_: Exception) {
                    false
                }
            }
            .maxByOrNull { it.createdAt }
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
        const val EVIDENCE_BUCKET = NativeReportRules.EVIDENCE_BUCKET
        const val MAX_EVIDENCE_BYTES = NativeReportRules.MAX_EVIDENCE_BYTES
        val ALLOWED_EVIDENCE_TYPES = NativeReportRules.ALLOWED_EVIDENCE_TYPES
        val REPORT_CATEGORIES = NativeReportRules.REPORT_CATEGORIES

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
