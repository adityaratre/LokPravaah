package online.lokpravaah.app.data

/**
 * Pure rules mirrored from the existing website and database constraints.
 * These do not replace server-side constraints or Supabase RLS.
 */
object NativeReportRules {
    const val EVIDENCE_BUCKET = "citizen-evidence"
    const val MAX_EVIDENCE_BYTES = 50L * 1024L * 1024L

    val ALLOWED_EVIDENCE_TYPES = setOf(
        "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"
    )

    val REPORT_CATEGORIES = listOf(
        "Roads & Footpaths",
        "Waste & Sanitation",
        "Streetlights",
        "Water & Drainage",
        "Public Safety",
        "Parks & Public Spaces",
        "Other"
    )

    fun validateReport(
        title: String,
        description: String,
        category: String,
        addressLabel: String,
        latitude: Double?,
        longitude: Double?
    ) {
        require(title.trim().length in 6..160) { "Report title must be between 6 and 160 characters." }
        require(description.trim().length <= 5000) { "Description cannot exceed 5,000 characters." }
        require(category in REPORT_CATEGORIES) { "Choose a valid report category." }
        require(addressLabel.trim().length >= 3) { "Enter an area, street or landmark." }
        require((latitude == null) == (longitude == null)) { "Enter both coordinates, or leave both empty." }
        require(latitude == null || latitude in -90.0..90.0) { "Latitude must be between -90 and 90." }
        require(longitude == null || longitude in -180.0..180.0) { "Longitude must be between -180 and 180." }
    }

    fun validateEvidence(mimeType: String, sizeBytes: Long?) {
        require(mimeType in ALLOWED_EVIDENCE_TYPES) {
            "Evidence must be JPG, PNG, WEBP, MP4 or WEBM."
        }
        require(sizeBytes == null || sizeBytes in 1..MAX_EVIDENCE_BYTES) {
            "Evidence file must be 50 MB or smaller and cannot be empty."
        }
    }

    fun suggestSeverity(category: String, title: String, description: String): String {
        val value = (category + " " + title + " " + description).lowercase()
        val urgentTerms = listOf(
            "live wire", "exposed wire", "electric shock", "gas leak", "fire", "open manhole",
            "building collapse", "wall collapse", "fallen electric pole", "electrocution",
            "खुला बिजली तार", "बिजली का तार", "गैस लीक", "आग लग", "खुला मैनहोल",
            "इमारत गिर", "दीवार गिर", "करंट लग"
        )
        val highTerms = listOf(
            "severe flooding", "water entering homes", "road collapsed", "major pothole",
            "sewage overflow", "contaminated drinking water", "dangerous road", "accident risk",
            "flooding", "overflowing drain", "गंभीर जलभराव", "घर में पानी", "सड़क धंस",
            "बड़ा गड्ढा", "सीवेज", "दूषित पानी", "दुर्घटना", "नाली का पानी", "खतरनाक सड़क"
        )
        return when {
            urgentTerms.any { value.contains(it) } -> "urgent"
            highTerms.any { value.contains(it) } -> "high"
            else -> "normal"
        }
    }
}
