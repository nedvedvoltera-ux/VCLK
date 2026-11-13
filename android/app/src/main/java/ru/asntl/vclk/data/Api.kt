package ru.asntl.vclk.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.source
import ru.asntl.vclk.util.attachmentMimeType
import ru.asntl.vclk.util.safeFileName
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(message: String, val code: Int = 0) : Exception(message)

/** Cookie-сессия `vclk_session` переживает перезапуск приложения. */
class PersistentCookieJar(private val prefs: SharedPreferences) : CookieJar {
    private val store = LinkedHashMap<String, Cookie>()
    private var baseUrl: HttpUrl? = null

    @Synchronized
    fun restore(base: HttpUrl?) {
        baseUrl = base
        store.clear()
        if (base == null) return
        prefs.getStringSet(KEY, emptySet())?.forEach { raw ->
            Cookie.parse(base, raw)?.let { store[key(it)] = it }
        }
    }

    @Synchronized
    fun clear() {
        store.clear()
        prefs.edit().remove(KEY).apply()
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            if (cookie.expiresAt <= now) store.remove(key(cookie)) else store[key(cookie)] = cookie
        }
        prefs.edit().putStringSet(KEY, store.values.map { it.toString() }.toSet()).apply()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return store.values.filter { it.expiresAt > now && it.matches(url) }
    }

    private fun key(cookie: Cookie) = "${cookie.name}|${cookie.domain}|${cookie.path}"

    private companion object {
        const val KEY = "cookies"
    }
}

class Api(private val context: Context) {
    private val prefs = context.getSharedPreferences("vclk", Context.MODE_PRIVATE)
    private val cookieJar = PersistentCookieJar(prefs)

    val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) {
            if (value != serverUrl) cookieJar.clear()
            prefs.edit().apply { if (value == null) remove("server_url") else putString("server_url", value) }.apply()
            cookieJar.restore(value?.toHttpUrlOrNull())
        }

    init {
        cookieJar.restore(serverUrl?.toHttpUrlOrNull())
    }

    private fun requireBase(): String = serverUrl ?: throw ApiException("Не указан адрес сервера")

    private suspend fun execute(request: Request): Response = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            throw ApiException("Нет связи с сервером: ${error.message ?: "ошибка сети"}")
        }
    }

    private fun failure(response: Response): ApiException {
        val raw = response.body?.string().orEmpty()
        val message = runCatching { json.decodeFromString<ErrorResponse>(raw).error }.getOrNull()
        return ApiException(message ?: "Ошибка запроса (${response.code})", response.code)
    }

    private fun build(method: String, path: String, body: JsonElement?): Request {
        val requestBody = when {
            body != null -> body.toString().toRequestBody(JSON_TYPE)
            method == "GET" || method == "DELETE" -> null
            else -> "{}".toRequestBody(JSON_TYPE)
        }
        return Request.Builder().url(requireBase() + path).method(method, requestBody).build()
    }

    private suspend inline fun <reified T> call(method: String, path: String, body: JsonElement? = null): T {
        execute(build(method, path, body)).use { response ->
            if (!response.isSuccessful) throw failure(response)
            val raw = withContext(Dispatchers.IO) { response.body?.string().orEmpty() }
            return try {
                json.decodeFromString<T>(raw)
            } catch (error: Exception) {
                throw ApiException("Некорректный ответ сервера")
            }
        }
    }

    private suspend fun callUnit(method: String, path: String, body: JsonElement? = null) {
        execute(build(method, path, body)).use { response ->
            if (!response.isSuccessful) throw failure(response)
        }
    }

    // ---------- Сессия ----------

    suspend fun bootstrap(): Bootstrap = call("GET", "/api/bootstrap")

    suspend fun me(): User = call<UserResponse>("GET", "/api/auth/me").user

    suspend fun login(email: String, password: String, ldap: Boolean): User =
        call<UserResponse>(
            "POST",
            "/api/auth/login",
            buildJsonObject {
                put("email", email)
                put("password", password)
                put("source", if (ldap) "ldap" else "local")
            },
        ).user

    suspend fun setup(email: String, password: String, displayName: String): User =
        call<UserResponse>(
            "POST",
            "/api/setup",
            buildJsonObject {
                put("email", email)
                put("password", password)
                put("displayName", displayName)
            },
        ).user

    suspend fun logout() {
        runCatching { callUnit("POST", "/api/auth/logout") }
        cookieJar.clear()
    }

    // ---------- Встречи ----------

    suspend fun meetings(): List<Meeting> =
        call<MeetingsResponse>("GET", "/api/meetings?from=2020-01-01&to=2100-01-01").meetings

    suspend fun meeting(id: String): Meeting = call<MeetingResponse>("GET", "/api/meetings/$id").meeting

    suspend fun recipients(): List<Recipient> = call<RecipientsResponse>("GET", "/api/users/recipients").users

    suspend fun saveMeeting(id: String?, payload: MeetingPayload): Meeting =
        call<MeetingResponse>(
            if (id == null) "POST" else "PATCH",
            if (id == null) "/api/meetings" else "/api/meetings/$id",
            payload.toJson(),
        ).meeting

    suspend fun deleteMeeting(id: String) = callUnit("DELETE", "/api/meetings/$id")

    suspend fun createInvite(meetingId: String, email: String): InviteResponse =
        call("POST", "/api/meetings/$meetingId/invites", buildJsonObject { put("email", email) })

    suspend fun inviteInfo(token: String): InviteInfo =
        call<InviteInfoResponse>("GET", "/api/invites/${Uri.encode(token)}").invite

    suspend fun activateInvite(token: String, displayName: String, password: String): ActivateResponse =
        call(
            "POST",
            "/api/invites/${Uri.encode(token)}/activate",
            buildJsonObject {
                put("displayName", displayName)
                put("password", password)
            },
        )

    // ---------- Вложения ----------

    fun fileName(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.let { return it }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "attachment"
    }

    fun fileSize(uri: Uri): Long {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index)
            }
        }
        return -1
    }

    suspend fun uploadAttachment(meetingId: String, uri: Uri, name: String) {
        val mime = attachmentMimeType(name)
            ?: throw ApiException("Допустимы только PDF, Office-документы, TXT, CSV, PNG и JPEG")
        val fileBody = object : RequestBody() {
            override fun contentType() = mime.toMediaType()
            override fun writeTo(sink: BufferedSink) {
                val stream = context.contentResolver.openInputStream(uri) ?: throw IOException("Не удалось открыть файл")
                stream.source().use { sink.writeAll(it) }
            }
        }
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", name, fileBody)
            .addFormDataPart("humanConfirmed", "true")
            .build()
        val request = Request.Builder().url(requireBase() + "/api/meetings/$meetingId/attachments").post(body).build()
        execute(request).use { response -> if (!response.isSuccessful) throw failure(response) }
    }

    /** Скачивает вложение в кеш и возвращает файл (для открытия через FileProvider). */
    suspend fun downloadAttachment(attachment: Attachment): File {
        val request = Request.Builder().url(requireBase() + "/api/attachments/${attachment.id}").get().build()
        execute(request).use { response ->
            if (!response.isSuccessful) throw failure(response)
            val dir = File(context.cacheDir, "attachments").apply { mkdirs() }
            val target = File(dir, "${attachment.id}-${safeFileName(attachment.original_name)}")
            withContext(Dispatchers.IO) {
                response.body!!.byteStream().use { input -> target.outputStream().use { input.copyTo(it) } }
            }
            return target
        }
    }

    // ---------- Комната ----------

    suspend fun join(meetingId: String, username: String, avatarUrl: String?): JoinResponse =
        call(
            "POST",
            "/api/meetings/$meetingId/join",
            buildJsonObject {
                put("username", username)
                put("avatarUrl", avatarUrl ?: "")
            },
        )

    suspend fun freeToken(room: String, username: String, avatarUrl: String?): String =
        call<TokenResponse>(
            "POST",
            "/token",
            buildJsonObject {
                put("room", room)
                put("username", username)
                put("avatarUrl", avatarUrl ?: "")
            },
        ).token

    suspend fun uploadAvatar(dataUrl: String): String =
        call<AvatarResponse>("POST", "/avatar", buildJsonObject { put("imageDataUrl", dataUrl) }).avatarUrl

    /** Загружает картинку (фото участника) по абсолютному URL. */
    suspend fun fetchBytes(url: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (response.isSuccessful) response.body?.bytes() else null
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun recordingStatus(room: String): RecordingState =
        call<RecordingStatusResponse>("GET", "/recording/status?room=${Uri.encode(room)}").recording

    suspend fun startRecording(room: String): String? =
        call<RecordingStartResponse>("POST", "/recording/start", buildJsonObject { put("room", room) }).egressId

    suspend fun stopRecording(room: String, egressId: String?): String? =
        call<RecordingStopResponse>(
            "POST",
            "/recording/stop",
            buildJsonObject {
                put("room", room)
                if (egressId != null) put("egressId", egressId)
            },
        ).warning

    private companion object {
        val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

/** Данные формы встречи в формате API. */
data class MeetingPayload(
    val title: String,
    val description: String,
    val startsAt: String,
    val endsAt: String,
    val timezone: String,
    val recordingEnabled: Boolean,
    val reminderMinutes: Int,
    val recurrence: String,
    val participantEmails: List<String>,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("title", title)
        put("description", description)
        put("startsAt", startsAt)
        put("endsAt", endsAt)
        put("timezone", timezone)
        put("recordingEnabled", recordingEnabled)
        put("reminderMinutes", reminderMinutes)
        put("recurrence", recurrence)
        put(
            "participants",
            JsonArray(participantEmails.map { email -> buildJsonObject { put("email", JsonPrimitive(email)) } }),
        )
    }
}
