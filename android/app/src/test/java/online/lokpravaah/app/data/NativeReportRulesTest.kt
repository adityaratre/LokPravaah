package online.lokpravaah.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeReportRulesTest {
    @Test
    fun acceptsExistingWebsiteReportCategoriesAndValidReport() {
        assertEquals(
            listOf("Roads & Footpaths", "Waste & Sanitation", "Streetlights", "Water & Drainage", "Public Safety", "Parks & Public Spaces", "Other"),
            NativeReportRules.REPORT_CATEGORIES
        )
        NativeReportRules.validateReport(
            title = "Broken streetlight",
            description = "The light has been off for several days.",
            category = "Streetlights",
            addressLabel = "Ward 4, Main Road",
            latitude = 22.0797,
            longitude = 82.1409
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsTitleShorterThanWebsiteMinimum() {
        NativeReportRules.validateReport("Short", "", "Streetlights", "Main Road", null, null)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsIncompleteCoordinatePair() {
        NativeReportRules.validateReport("Broken streetlight", "", "Streetlights", "Main Road", 22.0, null)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsCoordinatesOutsideDatabaseRange() {
        NativeReportRules.validateReport("Broken streetlight", "", "Streetlights", "Main Road", 91.0, 82.0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsCategoriesNotUsedByWebsite() {
        NativeReportRules.validateReport("Broken streetlight", "", "Something else", "Main Road", null, null)
    }

    @Test
    fun acceptsOnlyEvidenceTypesAllowedByPrivateBucket() {
        NativeReportRules.ALLOWED_EVIDENCE_TYPES.forEach { mimeType ->
            NativeReportRules.validateEvidence(mimeType, 1024L)
        }
        assertTrue(NativeReportRules.ALLOWED_EVIDENCE_TYPES.contains("image/jpeg"))
        assertTrue(NativeReportRules.ALLOWED_EVIDENCE_TYPES.contains("video/webm"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnsupportedEvidenceType() {
        NativeReportRules.validateEvidence("application/pdf", 1024L)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsEvidenceOverFiftyMegabytes() {
        NativeReportRules.validateEvidence("image/png", NativeReportRules.MAX_EVIDENCE_BYTES + 1L)
    }

    @Test
    fun prioritySuggestionUsesExistingWebsiteRules() {
        assertEquals("urgent", NativeReportRules.suggestSeverity("Public Safety", "Exposed wire", "A live wire hangs over the path"))
        assertEquals("high", NativeReportRules.suggestSeverity("Roads & Footpaths", "Major pothole", "Cars swerve into traffic"))
        assertEquals("normal", NativeReportRules.suggestSeverity("Parks & Public Spaces", "Broken bench", "The bench is damaged"))
    }
}
