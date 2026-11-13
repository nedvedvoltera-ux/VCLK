package ru.asntl.vclk.util

import java.net.URI
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

val RU: Locale = Locale.forLanguageTag("ru-RU")

const val MAX_ATTACHMENT_BYTES = 20L * 1024 * 1024
const val MAX_ATTACHMENTS = 10
const val UPLOAD_COOLDOWN_MS = 3200L
val ATTACHMENT_MIME_TYPES = arrayOf(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
)

private val ATTACHMENT_TYPE_BY_EXTENSION = mapOf(
    "pdf" to "application/pdf",
    "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt" to "text/plain",
    "csv" to "text/csv",
    "png" to "image/png",
    "jpg" to "image/jpeg",
    "jpeg" to "image/jpeg",
)

/** MIME для загрузки вложения по расширению (сервер сверяет расширение и MIME); null — тип не разрешён. */
fun attachmentMimeType(fileName: String): String? =
    ATTACHMENT_TYPE_BY_EXTENSION[fileName.substringAfterLast('.', "").lowercase()]

/** Допустимые значения периода повторения (совпадают с сервером). */
enum class Recurrence(val value: String, val label: String) {
    None("none", "Не повторять"),
    Daily("daily", "Каждый день"),
    Weekly("weekly", "Каждую неделю"),
    Monthly("monthly", "Каждый месяц");

    companion object {
        fun from(value: String?): Recurrence = entries.firstOrNull { it.value == value } ?: None
        val periods: List<Recurrence> = listOf(Daily, Weekly, Monthly)
    }
}

fun reminderLabel(minutes: Int?): String = when {
    minutes == null || minutes <= 0 -> "Без напоминания"
    minutes == 60 -> "За 1 час"
    else -> "За $minutes мин."
}

val REMINDER_OPTIONS: List<Pair<Int, String>> = listOf(
    0 to "Без напоминания",
    15 to "За 15 минут",
    30 to "За 30 минут",
    60 to "За 1 час",
)

/** Приводит введённый адрес сервера к виду `https://host[:port]`, либо null, если адрес некорректен. */
fun normalizeServerUrl(input: String): String? {
    var value = input.trim()
    if (value.isEmpty()) return null
    if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(value)) value = "https://$value"
    return try {
        val uri = URI(value)
        val scheme = uri.scheme?.lowercase()
        if ((scheme != "https" && scheme != "http") || uri.host.isNullOrBlank()) return null
        val port = if (uri.port > 0) ":${uri.port}" else ""
        "$scheme://${uri.host}$port"
    } catch (_: Exception) {
        null
    }
}

/** Адрес сигналинга LiveKit через nginx-прокси: `wss://host/livekit`. */
fun buildSignalingUrl(serverUrl: String): String {
    val uri = URI(serverUrl)
    val scheme = if (uri.scheme.equals("https", ignoreCase = true)) "wss" else "ws"
    val port = if (uri.port > 0) ":${uri.port}" else ""
    return "$scheme://${uri.host}$port/livekit"
}

fun buildInviteLink(serverUrl: String, room: String, defaultRoom: String = "demo-room"): String =
    "$serverUrl/room?room=" + java.net.URLEncoder.encode(room.trim().ifEmpty { defaultRoom }, "UTF-8")

fun buildMeetingLink(serverUrl: String, meetingId: String): String = "$serverUrl/room?meeting=$meetingId"

fun canJoin(room: String, username: String): Boolean = room.trim().isNotEmpty() && username.trim().isNotEmpty()

fun isNonEmptyChatMessage(value: String): Boolean = value.trim().isNotEmpty()

enum class NetworkQuality(val label: String) {
    Low("Слабая сеть"), Medium("Средняя сеть"), High("Хорошая сеть"), Unknown("Качество сети неизвестно")
}

fun networkQualityFromMbps(mbps: Double?): NetworkQuality = when {
    mbps == null || mbps.isNaN() || mbps.isInfinite() -> NetworkQuality.Unknown
    mbps < 5 -> NetworkQuality.Low
    mbps <= 15 -> NetworkQuality.Medium
    else -> NetworkQuality.High
}

/**
 * Автозапись: включена опция встречи, в комнате 2 и более участников,
 * запись ещё не идёт и попытка раньше не делалась.
 */
fun shouldAutoStartRecording(
    recordingEnabled: Boolean,
    participantCount: Int,
    alreadyRecording: Boolean,
    alreadyAttempted: Boolean,
): Boolean = recordingEnabled && participantCount >= 2 && !alreadyRecording && !alreadyAttempted

/** Демонстрация экрана стоит перед камерами. */
fun <T> sortByScreenSharePriority(items: List<T>, isScreenShare: (T) -> Boolean): List<T> =
    items.sortedBy { if (isScreenShare(it)) 0 else 1 }

enum class MobileLayoutMode { Single, Two, Stack }

fun mobileLayoutMode(trackCount: Int): MobileLayoutMode = when {
    trackCount <= 1 -> MobileLayoutMode.Single
    trackCount == 2 -> MobileLayoutMode.Two
    else -> MobileLayoutMode.Stack
}

/** URL фото участника из metadata LiveKit (`{"avatarUrl":"/avatar/…"}`) с учётом адреса сервера. */
fun parseParticipantAvatarUrl(metadata: String?, serverUrl: String): String? {
    if (metadata.isNullOrBlank()) return null
    val match = Regex("\"avatarUrl\"\\s*:\\s*\"([^\"]+)\"").find(metadata) ?: return null
    val raw = match.groupValues[1].replace("\\/", "/")
    return when {
        raw.startsWith("http://") || raw.startsWith("https://") -> raw
        raw.startsWith("/") -> serverUrl.trimEnd('/') + raw
        else -> null
    }
}

// ---------- Даты ----------

fun parseInstant(value: String): Instant = Instant.parse(value)

fun Instant.toLocalDateTime(zone: ZoneId = ZoneId.systemDefault()): LocalDateTime =
    LocalDateTime.ofInstant(this, zone)

fun LocalDateTime.toInstant(zone: ZoneId = ZoneId.systemDefault()): Instant = atZone(zone).toInstant()

fun Instant.toIsoString(): String = toString()

private val dateTimeFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(RU)

fun formatDateTime(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
    dateTimeFormat.format(parseInstant(value).toLocalDateTime(zone))

fun formatDayMonth(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
    DateTimeFormatter.ofPattern("d MMM", RU).format(parseInstant(value).toLocalDateTime(zone))

fun formatTime(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
    DateTimeFormatter.ofPattern("HH:mm", RU).format(parseInstant(value).toLocalDateTime(zone))

fun formatTime(value: LocalDateTime): String = DateTimeFormatter.ofPattern("HH:mm", RU).format(value)

fun formatDateTime(value: LocalDateTime): String =
    DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", RU).format(value)

/**
 * При правке одного вхождения серии время всей серии сдвигается на ту же разницу:
 * base + (new - occurrence).
 */
fun shiftSeriesTime(seriesTime: Instant, occurrenceTime: Instant, newTime: Instant): Instant =
    seriesTime.plusMillis(newTime.toEpochMilli() - occurrenceTime.toEpochMilli())

/** Следующий «час» от текущего момента: время по умолчанию для новой встречи. */
fun defaultMeetingStart(now: LocalDateTime = LocalDateTime.now()): LocalDateTime =
    now.plusHours(1).withMinute(0).withSecond(0).withNano(0)

/** Ближайшие встречи: серия показывается один раз (ближайшее вхождение), ещё не закончившиеся. */
fun <T> upcomingDistinctSeries(
    items: List<T>,
    now: Instant,
    limit: Int,
    idOf: (T) -> String,
    endsAtOf: (T) -> Instant,
    isScheduled: (T) -> Boolean,
): List<T> {
    val seen = HashSet<String>()
    val result = ArrayList<T>()
    for (item in items) {
        if (endsAtOf(item).isBefore(now) || !isScheduled(item) || !seen.add(idOf(item))) continue
        result.add(item)
        if (result.size >= limit) break
    }
    return result
}

fun humanFileSize(bytes: Long): String = String.format(Locale.US, "%.1f МБ", bytes / 1024.0 / 1024.0)

/** Имя попадает только в имя файла кеша — убираем недопустимые символы. */
fun safeFileName(name: String): String =
    name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().ifEmpty { "attachment" }.take(120)
