package ru.asntl.vclk

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import ru.asntl.vclk.data.Api
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.Attachment
import ru.asntl.vclk.data.Bootstrap
import ru.asntl.vclk.data.JoinTarget
import ru.asntl.vclk.data.Meeting
import ru.asntl.vclk.data.MeetingPayload
import ru.asntl.vclk.data.Recipient
import ru.asntl.vclk.data.RoomSession
import ru.asntl.vclk.data.User
import ru.asntl.vclk.util.MAX_ATTACHMENTS
import ru.asntl.vclk.util.MAX_ATTACHMENT_BYTES
import ru.asntl.vclk.util.UPLOAD_COOLDOWN_MS
import ru.asntl.vclk.util.buildInviteLink
import ru.asntl.vclk.util.buildMeetingLink
import ru.asntl.vclk.util.buildSignalingUrl
import ru.asntl.vclk.util.normalizeServerUrl
import java.io.File

sealed interface UiEvent {
    data class Toast(val title: String, val description: String? = null, val isError: Boolean = false) : UiEvent
    data class OpenFile(val file: File, val mime: String) : UiEvent
}

class AppViewModel(application: Application) : AndroidViewModel(application) {
    val api = Api(application)

    var serverUrl by mutableStateOf(api.serverUrl)
        private set
    var checking by mutableStateOf(true)
        private set
    var user by mutableStateOf<User?>(null)
        private set
    var modes by mutableStateOf(Bootstrap())
        private set
    var meetings by mutableStateOf<List<Meeting>>(emptyList())
        private set
    var recipients by mutableStateOf<List<Recipient>>(emptyList())
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    var inviteToken by mutableStateOf<String?>(null)
        private set
    var joinTarget by mutableStateOf<JoinTarget?>(null)
        private set
    var roomSession by mutableStateOf<RoomSession?>(null)
        private set
    var roomTitle by mutableStateOf("")
        private set

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<UiEvent> = _events

    /** Встреча/комната из ссылки, которую откроем после входа. */
    private var pendingTarget: JoinTarget? = null
    private var lastUploadAt = 0L

    init {
        refreshSession()
    }

    fun toast(title: String, description: String? = null, isError: Boolean = false) {
        _events.tryEmit(UiEvent.Toast(title, description, isError))
    }

    // ---------- Сервер и сессия ----------

    /** Возвращает текст ошибки, если адрес некорректен. */
    fun setServer(input: String): String? {
        val normalized = normalizeServerUrl(input) ?: return "Введите адрес сервера, например https://vclk.company.ru"
        api.serverUrl = normalized
        serverUrl = normalized
        user = null
        meetings = emptyList()
        refreshSession()
        return null
    }

    fun changeServer() {
        viewModelScope.launch { api.logout() }
        api.serverUrl = null
        serverUrl = null
        user = null
        meetings = emptyList()
        recipients = emptyList()
        joinTarget = null
        roomSession = null
    }

    fun refreshSession() {
        if (api.serverUrl == null) {
            checking = false
            return
        }
        checking = true
        viewModelScope.launch {
            try {
                modes = api.bootstrap()
            } catch (error: ApiException) {
                loadError = error.message
            }
            try {
                user = api.me()
                loadError = null
                onSignedIn()
            } catch (error: ApiException) {
                user = null
                if (error.code != 401 && loadError == null) loadError = error.message
            }
            checking = false
        }
    }

    fun refreshModes() {
        viewModelScope.launch { runCatching { modes = api.bootstrap() } }
    }

    private suspend fun onSignedIn() {
        loadMeetingsInternal()
        runCatching { recipients = api.recipients() }
        pendingTarget?.let {
            pendingTarget = null
            joinTarget = it
        }
    }

    suspend fun login(email: String, password: String, ldap: Boolean) {
        user = api.login(email.trim(), password, ldap)
        loadError = null
        onSignedIn()
    }

    suspend fun setupAdmin(email: String, password: String, displayName: String) {
        user = api.setup(email.trim(), password, displayName.trim())
        modes = runCatching { api.bootstrap() }.getOrDefault(modes)
        onSignedIn()
    }

    fun logout() {
        viewModelScope.launch {
            api.logout()
            user = null
            meetings = emptyList()
            recipients = emptyList()
            joinTarget = null
            roomSession = null
            refreshModes()
        }
    }

    // ---------- Встречи ----------

    fun loadMeetings() {
        viewModelScope.launch { loadMeetingsInternal() }
    }

    private suspend fun loadMeetingsInternal() {
        try {
            meetings = api.meetings()
            loadError = null
        } catch (error: ApiException) {
            if (error.code == 401) user = null else loadError = error.message
        }
    }

    suspend fun saveMeeting(id: String?, payload: MeetingPayload): Meeting {
        val saved = api.saveMeeting(id, payload)
        loadMeetingsInternal()
        return saved
    }

    suspend fun deleteMeeting(id: String) {
        api.deleteMeeting(id)
        loadMeetingsInternal()
    }

    /** Создаёт приглашение; возвращает ссылку и предупреждение сервера. */
    suspend fun invite(meetingId: String, email: String) = api.createInvite(meetingId, email.trim())

    /** Загрузка вложения с теми же ограничениями, что и в вебе. Бросает ApiException с текстом для пользователя. */
    suspend fun uploadAttachment(meetingId: String, uri: Uri, existingCount: Int) {
        val name = api.fileName(uri)
        val size = api.fileSize(uri)
        if (size > MAX_ATTACHMENT_BYTES) throw ApiException("«$name» больше 20 МБ")
        if (existingCount >= MAX_ATTACHMENTS) throw ApiException("К встрече можно прикрепить не более $MAX_ATTACHMENTS файлов")
        val wait = UPLOAD_COOLDOWN_MS - (System.currentTimeMillis() - lastUploadAt)
        if (wait > 0) delay(wait)
        api.uploadAttachment(meetingId, uri, name)
        lastUploadAt = System.currentTimeMillis()
    }

    fun openAttachment(attachment: Attachment) {
        viewModelScope.launch {
            try {
                val file = api.downloadAttachment(attachment)
                _events.emit(UiEvent.OpenFile(file, attachment.content_type.ifBlank { "*/*" }))
            } catch (error: ApiException) {
                toast("Не удалось открыть файл", error.message, isError = true)
            }
        }
    }

    // ---------- Ссылки ----------

    fun handleLink(uri: Uri) {
        val scheme = uri.scheme ?: return
        val host = uri.host ?: return
        val origin = buildString {
            append(scheme).append("://").append(host)
            if (uri.port > 0) append(":").append(uri.port)
        }
        val path = uri.path.orEmpty()
        val isInvite = path.startsWith("/invite/")
        val isRoom = path == "/room"
        if (!isInvite && !isRoom) return
        if (serverUrl != origin) {
            api.serverUrl = origin
            serverUrl = origin
            user = null
            meetings = emptyList()
        }
        if (isInvite) {
            inviteToken = path.removePrefix("/invite/").trim('/').ifEmpty { null }
            refreshModes()
            checking = false
            return
        }
        val meetingId = uri.getQueryParameter("meeting")
        val room = uri.getQueryParameter("room").orEmpty()
        val target = JoinTarget(meetingId = meetingId, roomCode = room)
        if (user != null) {
            openWaiting(target)
        } else {
            pendingTarget = target
            refreshSession()
        }
    }

    fun finishInviteActivation(activated: User, meetingId: String) {
        inviteToken = null
        user = activated
        viewModelScope.launch {
            onSignedIn()
            if (meetingId.isNotEmpty()) joinTarget = JoinTarget(meetingId = meetingId)
        }
    }

    fun cancelInvite() {
        inviteToken = null
    }

    // ---------- Комната ----------

    fun openWaiting(target: JoinTarget) {
        joinTarget = target
    }

    fun closeWaiting() {
        joinTarget = null
    }

    /**
     * Получает токен LiveKit для встречи или свободной комнаты.
     * Бросает ApiException с понятным сообщением.
     */
    suspend fun startJoin(
        target: JoinTarget,
        username: String,
        avatarDataUrl: String?,
        micEnabled: Boolean,
        cameraEnabled: Boolean,
        frontCamera: Boolean,
    ) {
        val base = serverUrl ?: throw ApiException("Не указан адрес сервера")
        val avatarUrl = avatarDataUrl?.let { runCatching { api.uploadAvatar(it) }.getOrNull() }
        val session = if (target.meetingId != null) {
            val response = api.join(target.meetingId, username.trim(), avatarUrl)
            roomTitle = response.meeting?.title ?: target.title ?: response.roomName
            RoomSession(
                token = response.token,
                roomName = response.roomName,
                signalingUrl = buildSignalingUrl(base),
                autoRecord = response.meeting?.recording_enabled == true,
                micEnabled = micEnabled,
                cameraEnabled = cameraEnabled,
                frontCamera = frontCamera,
                inviteLink = buildMeetingLink(base, target.meetingId),
            )
        } else {
            if (!modes.freeMode) {
                throw ApiException("Свободный режим отключён администратором. Войдите через запланированную встречу.")
            }
            val room = target.roomCode.trim()
            val token = api.freeToken(room, username.trim(), avatarUrl)
            roomTitle = room
            RoomSession(
                token = token,
                roomName = room,
                signalingUrl = buildSignalingUrl(base),
                autoRecord = false,
                micEnabled = micEnabled,
                cameraEnabled = cameraEnabled,
                frontCamera = frontCamera,
                inviteLink = buildInviteLink(base, room),
            )
        }
        roomSession = session
        joinTarget = null
    }

    fun leaveRoom() {
        roomSession = null
        refreshModes()
        if (user != null) loadMeetings()
    }
}
