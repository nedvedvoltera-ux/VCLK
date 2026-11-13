package ru.asntl.vclk.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime

class HelpersTest {
    @Test
    fun normalizesServerUrl() {
        assertEquals("https://vclk.asntl.ru", normalizeServerUrl("vclk.asntl.ru"))
        assertEquals("https://vclk.asntl.ru", normalizeServerUrl("  https://vclk.asntl.ru/ "))
        assertEquals("http://192.168.215.44:8080", normalizeServerUrl("http://192.168.215.44:8080/path"))
        assertNull(normalizeServerUrl(""))
        assertNull(normalizeServerUrl("ftp://host"))
    }

    @Test
    fun buildsSignalingUrl() {
        assertEquals("wss://vclk.asntl.ru/livekit", buildSignalingUrl("https://vclk.asntl.ru"))
        assertEquals("ws://10.0.0.5:8080/livekit", buildSignalingUrl("http://10.0.0.5:8080"))
    }

    @Test
    fun buildsLinks() {
        assertEquals("https://h/room?room=demo-room", buildInviteLink("https://h", "  "))
        assertEquals("https://h/room?meeting=abc", buildMeetingLink("https://h", "abc"))
    }

    @Test
    fun recurrenceParsing() {
        assertEquals(Recurrence.Weekly, Recurrence.from("weekly"))
        assertEquals(Recurrence.None, Recurrence.from("yearly"))
        assertEquals(Recurrence.None, Recurrence.from(null))
        assertEquals(listOf("daily", "weekly", "monthly"), Recurrence.periods.map { it.value })
    }

    @Test
    fun reminderLabels() {
        assertEquals("Без напоминания", reminderLabel(null))
        assertEquals("Без напоминания", reminderLabel(0))
        assertEquals("За 1 час", reminderLabel(60))
        assertEquals("За 15 мин.", reminderLabel(15))
    }

    @Test
    fun autoRecordNeedsTwoParticipantsAndSingleAttempt() {
        assertTrue(shouldAutoStartRecording(true, 2, alreadyRecording = false, alreadyAttempted = false))
        assertFalse(shouldAutoStartRecording(true, 1, false, false))
        assertFalse(shouldAutoStartRecording(false, 3, false, false))
        assertFalse(shouldAutoStartRecording(true, 2, true, false))
        assertFalse(shouldAutoStartRecording(true, 2, false, true))
    }

    @Test
    fun screenShareGoesFirst() {
        val sorted = sortByScreenSharePriority(listOf("cam1", "screen", "cam2")) { it == "screen" }
        assertEquals(listOf("screen", "cam1", "cam2"), sorted)
    }

    @Test
    fun layoutModeByTrackCount() {
        assertEquals(MobileLayoutMode.Single, mobileLayoutMode(0))
        assertEquals(MobileLayoutMode.Single, mobileLayoutMode(1))
        assertEquals(MobileLayoutMode.Two, mobileLayoutMode(2))
        assertEquals(MobileLayoutMode.Stack, mobileLayoutMode(5))
    }

    @Test
    fun networkQualityThresholds() {
        assertEquals(NetworkQuality.Unknown, networkQualityFromMbps(null))
        assertEquals(NetworkQuality.Low, networkQualityFromMbps(4.9))
        assertEquals(NetworkQuality.Medium, networkQualityFromMbps(5.0))
        assertEquals(NetworkQuality.Medium, networkQualityFromMbps(15.0))
        assertEquals(NetworkQuality.High, networkQualityFromMbps(15.1))
    }

    @Test
    fun avatarUrlFromMetadata() {
        assertEquals(
            "https://h/avatar/x.jpg",
            parseParticipantAvatarUrl("{\"avatarUrl\":\"/avatar/x.jpg\"}", "https://h/"),
        )
        assertEquals(
            "https://cdn/a.jpg",
            parseParticipantAvatarUrl("{\"avatarUrl\":\"https://cdn/a.jpg\"}", "https://h"),
        )
        assertNull(parseParticipantAvatarUrl(null, "https://h"))
        assertNull(parseParticipantAvatarUrl("{}", "https://h"))
    }

    @Test
    fun editingOneOccurrenceShiftsWholeSeries() {
        val seriesStart = Instant.parse("2026-07-20T10:00:00Z")
        val occurrenceStart = Instant.parse("2026-07-27T10:00:00Z")
        val newStart = Instant.parse("2026-07-27T11:30:00Z")
        assertEquals(Instant.parse("2026-07-20T11:30:00Z"), shiftSeriesTime(seriesStart, occurrenceStart, newStart))
        assertEquals(seriesStart, shiftSeriesTime(seriesStart, occurrenceStart, occurrenceStart))
    }

    @Test
    fun defaultStartIsNextFullHour() {
        val start = defaultMeetingStart(LocalDateTime.of(2026, 7, 20, 9, 41, 12))
        assertEquals(LocalDateTime.of(2026, 7, 20, 10, 0), start)
    }

    @Test
    fun upcomingShowsSeriesOnce() {
        data class Item(val id: String, val ends: Instant, val scheduled: Boolean = true)
        val now = Instant.parse("2026-07-20T10:00:00Z")
        val items = listOf(
            Item("past", Instant.parse("2026-07-20T09:00:00Z")),
            Item("series", Instant.parse("2026-07-21T11:00:00Z")),
            Item("series", Instant.parse("2026-07-22T11:00:00Z")),
            Item("cancelled", Instant.parse("2026-07-23T11:00:00Z"), scheduled = false),
            Item("single", Instant.parse("2026-07-24T11:00:00Z")),
        )
        val result = upcomingDistinctSeries(items, now, 6, { it.id }, { it.ends }, { it.scheduled })
        assertEquals(listOf("series", "single"), result.map { it.id })
    }

    @Test
    fun formatsIsoWithoutOffsetNoise() {
        assertEquals("2026-07-20T10:00:00Z", Instant.parse("2026-07-20T10:00:00Z").toIsoString())
    }

    @Test
    fun linkifiesUrlsWwwAndEmails() {
        val tokens = tokenizeLinks("Ссылка https://zoom.us/j/1, сайт www.asntl.ru и почта a.b@asntl.ru.")
        val links = tokens.filter { it.kind != LinkKind.Text }
        assertEquals(listOf("https://zoom.us/j/1", "www.asntl.ru", "a.b@asntl.ru"), links.map { it.text })
        assertEquals(listOf("https://zoom.us/j/1", "https://www.asntl.ru", "mailto:a.b@asntl.ru"), links.map { it.href })
        assertEquals("Ссылка https://zoom.us/j/1, сайт www.asntl.ru и почта a.b@asntl.ru.", tokens.joinToString("") { it.text })
    }

    @Test
    fun attachmentMimeFollowsExtension() {
        assertEquals("application/pdf", attachmentMimeType("Протокол.PDF"))
        assertEquals("image/jpeg", attachmentMimeType("photo.jpeg"))
        assertNull(attachmentMimeType("archive.zip"))
        assertNull(attachmentMimeType("noextension"))
    }

    @Test
    fun safeFileNameStripsSeparators() {
        assertEquals("a_b.pdf", safeFileName("a/b.pdf"))
        assertEquals("attachment", safeFileName("  "))
    }
}
