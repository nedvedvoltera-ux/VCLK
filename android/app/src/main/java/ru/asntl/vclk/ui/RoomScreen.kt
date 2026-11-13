@file:OptIn(ExperimentalMaterial3Api::class, io.livekit.android.annotations.Beta::class)

package ru.asntl.vclk.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.StopScreenShare
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.twilio.audioswitch.AudioDevice
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.compose.chat.rememberChat
import io.livekit.android.compose.local.RoomLocal
import io.livekit.android.compose.state.rememberConnectionState
import io.livekit.android.compose.state.rememberLocalMedia
import io.livekit.android.compose.state.rememberParticipantInfo
import io.livekit.android.compose.state.rememberParticipants
import io.livekit.android.compose.state.rememberTrackMuted
import io.livekit.android.compose.state.rememberTracks
import io.livekit.android.compose.types.TrackReference
import io.livekit.android.compose.ui.ScaleType
import io.livekit.android.compose.ui.VideoTrackView
import io.livekit.android.room.Room
import io.livekit.android.room.participant.LocalParticipant
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import io.livekit.android.util.flow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.asntl.vclk.AppViewModel
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.RoomSession
import ru.asntl.vclk.util.MobileLayoutMode
import ru.asntl.vclk.util.formatTime
import ru.asntl.vclk.util.isNonEmptyChatMessage
import ru.asntl.vclk.util.mobileLayoutMode
import ru.asntl.vclk.util.parseParticipantAvatarUrl
import ru.asntl.vclk.util.shouldAutoStartRecording
import ru.asntl.vclk.util.sortByScreenSharePriority
import ru.asntl.vclk.util.toLocalDateTime
import java.time.Instant

private fun TrackReference.tileId(): String = "${participant.identity?.value}:${source.name}"

private fun Participant.displayName(): String = name?.takeIf { it.isNotBlank() } ?: identity?.value ?: "Участник"

/** Небольшой кэш фото участников: адрес → bitmap. */
private object AvatarCache {
    private val map = HashMap<String, Bitmap>()

    @Synchronized
    fun get(url: String): Bitmap? = map[url]

    @Synchronized
    fun put(url: String, bitmap: Bitmap) {
        map[url] = bitmap
    }
}

@Composable
private fun rememberAvatar(vm: AppViewModel, url: String?): Bitmap? {
    val state = produceState<Bitmap?>(initialValue = url?.let(AvatarCache::get), url) {
        if (url == null) {
            value = null
            return@produceState
        }
        AvatarCache.get(url)?.let { value = it; return@produceState }
        val bitmap = withContext(Dispatchers.Default) {
            vm.api.fetchBytes(url)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
        }
        if (bitmap != null) AvatarCache.put(url, bitmap)
        value = bitmap
    }
    return state.value
}

/** Комната общения: подключение к LiveKit, плитки участников, чат, запись и демонстрация экрана. */
@Composable
fun RoomScreen(vm: AppViewModel, session: RoomSession) {
    val context = LocalContext.current
    val view = LocalView.current

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    val room = remember(session) {
        LiveKit.create(context.applicationContext, RoomOptions(adaptiveStream = true, dynacast = true)).also { created ->
            created.videoTrackCaptureDefaults = LocalVideoTrackOptions(
                position = if (session.frontCamera) CameraPosition.FRONT else CameraPosition.BACK,
            )
        }
    }
    var connected by remember(room) { mutableStateOf(false) }

    LaunchedEffect(room) {
        try {
            room.connect(session.signalingUrl, session.token)
        } catch (caught: Exception) {
            vm.toast("Не удалось подключиться к комнате", caught.message, isError = true)
            vm.leaveRoom()
            return@LaunchedEffect
        }
        connected = true
        // Видео-звонку по умолчанию подходит громкая связь, если не подключены наушники.
        room.audioSwitchHandler?.let { handler ->
            val devices = handler.availableAudioDevices
            val external = devices.any { it is AudioDevice.BluetoothHeadset || it is AudioDevice.WiredHeadset }
            if (!external) devices.firstOrNull { it is AudioDevice.Speakerphone }?.let(handler::selectDevice)
        }
        if (session.micEnabled) runCatching { room.localParticipant.setMicrophoneEnabled(true) }
        if (session.cameraEnabled) runCatching { room.localParticipant.setCameraEnabled(true) }
    }
    DisposableEffect(room) {
        onDispose {
            room.disconnect()
            room.release()
        }
    }

    val connectionState by rememberConnectionState(room)
    LaunchedEffect(connectionState, connected) {
        if (connected && connectionState == Room.State.DISCONNECTED) {
            vm.toast("Соединение завершено", isError = false)
            vm.leaveRoom()
        }
    }

    CompositionLocalProvider(RoomLocal provides room) {
        RoomContent(vm, session, room, connected)
    }
}

@Composable
private fun RoomContent(vm: AppViewModel, session: RoomSession, room: Room, connected: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val serverUrl = vm.serverUrl.orEmpty()
    val signedIn = vm.user != null

    val media = rememberLocalMedia(room)
    val participants by rememberParticipants(room)
    val tracks by rememberTracks(
        sources = listOf(Track.Source.CAMERA, Track.Source.SCREEN_SHARE),
        usePlaceholders = setOf(Track.Source.CAMERA),
        passedRoom = room,
    )
    val chat = rememberChat(room)
    val messages = chat.messages.value

    var gridMode by remember { mutableStateOf(false) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var frontFacing by remember { mutableStateOf(session.frontCamera) }
    var showParticipants by remember { mutableStateOf(false) }
    var showChat by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var seenMessages by remember { mutableIntStateOf(0) }

    // Запись
    var recording by remember { mutableStateOf(false) }
    var egressId by remember { mutableStateOf<String?>(null) }
    var recordingBusy by remember { mutableStateOf(false) }
    var autoAttempted by remember { mutableStateOf(false) }

    suspend fun refreshRecording() {
        runCatching { vm.api.recordingStatus(session.roomName) }.onSuccess {
            recording = it.active
            egressId = it.egressId
        }
    }

    suspend fun startRecording() {
        recordingBusy = true
        try {
            egressId = vm.api.startRecording(session.roomName)
            recording = true
            refreshRecording()
        } finally {
            recordingBusy = false
        }
    }

    LaunchedEffect(connected, signedIn) {
        if (!connected || !signedIn) return@LaunchedEffect
        while (true) {
            refreshRecording()
            delay(4000)
        }
    }

    LaunchedEffect(participants.size, recording, connected) {
        if (!connected || !signedIn) return@LaunchedEffect
        if (shouldAutoStartRecording(session.autoRecord, participants.size, recording, autoAttempted)) {
            autoAttempted = true
            try {
                startRecording()
                vm.toast("Запись началась", "Автозапись включена: в комнате два участника.")
            } catch (caught: ApiException) {
                vm.toast("Не удалось начать запись", caught.message, isError = true)
            }
        }
    }

    // Демонстрация экрана
    val screenShareLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            scope.launch {
                try {
                    media.setScreenShareEnabled(true, ScreenCaptureParams(data))
                } catch (caught: Exception) {
                    vm.toast("Не удалось показать экран", caught.message, isError = true)
                }
            }
        }
    }

    val ordered = remember(tracks) { sortByScreenSharePriority(tracks) { it.source == Track.Source.SCREEN_SHARE } }
    val mainTrack = ordered.firstOrNull { it.tileId() == selectedId }
        ?: ordered.firstOrNull { it.source == Track.Source.SCREEN_SHARE }
        ?: ordered.firstOrNull { it.participant !is LocalParticipant }
        ?: ordered.firstOrNull()
    val unread = (messages.size - seenMessages).coerceAtLeast(0)
    LaunchedEffect(showChat, messages.size) {
        if (showChat) seenMessages = messages.size
    }

    BackHandler { confirmLeave = true }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Верхняя панель
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val clock by produceState("") {
                while (true) {
                    value = formatTime(java.time.LocalDateTime.now())
                    delay(15_000)
                }
            }
            Text(clock, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f)) {
                Text(
                    vm.roomTitle.ifBlank { session.roomName },
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (connected) "Участников: ${participants.size}" else "Подключение…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (recording) RecBadge()
            IconButton(onClick = { showParticipants = !showParticipants }) {
                Icon(Icons.Filled.Group, contentDescription = "Участники")
            }
            if (session.inviteLink.isNotEmpty()) {
                IconButton(onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Ссылка на комнату", session.inviteLink))
                    vm.toast("Ссылка скопирована", session.inviteLink)
                }) { Icon(Icons.Filled.ContentCopy, contentDescription = "Скопировать ссылку") }
            }
        }

        // Сцена
        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp)) {
            when {
                !connected -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                ordered.isEmpty() -> Text(
                    "Ожидание участников…",
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                gridMode -> GridStage(vm, ordered, serverUrl, frontFacing) { selectedId = it.tileId(); gridMode = false }
                else -> FocusStage(
                    vm = vm,
                    ordered = ordered,
                    main = mainTrack ?: ordered.first(),
                    serverUrl = serverUrl,
                    frontFacing = frontFacing,
                    onSelect = { selectedId = it.tileId() },
                )
            }
            if (showParticipants) {
                ParticipantsPanel(participants, Modifier.align(Alignment.TopEnd).padding(4.dp)) { showParticipants = false }
            }
        }

        // Панель управления
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilledIconToggleButton(
                checked = media.isMicrophoneEnabled,
                onCheckedChange = { scope.launch { runCatching { media.setMicrophoneEnabled(it) } } },
                enabled = connected,
            ) { Icon(if (media.isMicrophoneEnabled) Icons.Filled.Mic else Icons.Filled.MicOff, contentDescription = "Микрофон") }
            FilledIconToggleButton(
                checked = media.isCameraEnabled,
                onCheckedChange = { scope.launch { runCatching { media.setCameraEnabled(it) } } },
                enabled = connected,
            ) { Icon(if (media.isCameraEnabled) Icons.Filled.Videocam else Icons.Filled.VideocamOff, contentDescription = "Камера") }
            if (media.isCameraEnabled) {
                FilledTonalIconButton(onClick = {
                    media.switchCamera()
                    frontFacing = !frontFacing
                }) { Icon(Icons.Filled.FlipCameraAndroid, contentDescription = "Сменить камеру") }
            }
            FilledIconToggleButton(
                checked = media.isScreenShareEnabled,
                onCheckedChange = { enable ->
                    if (enable) {
                        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                        screenShareLauncher.launch(manager.createScreenCaptureIntent())
                    } else {
                        scope.launch { runCatching { media.setScreenShareEnabled(false) } }
                    }
                },
                enabled = connected,
            ) {
                Icon(
                    if (media.isScreenShareEnabled) Icons.Filled.StopScreenShare else Icons.Filled.ScreenShare,
                    contentDescription = "Демонстрация экрана",
                )
            }
            FilledTonalIconButton(onClick = { showChat = true }) {
                BadgedBox(badge = { if (unread > 0) Badge { Text(unread.toString()) } }) {
                    Icon(Icons.Filled.Chat, contentDescription = "Сообщения")
                }
            }
            Box {
                FilledTonalIconButton(onClick = { showMenu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Ещё") }
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (gridMode) "Вид: фокус" else "Вид: сетка") },
                        onClick = {
                            gridMode = !gridMode
                            showMenu = false
                        },
                    )
                    if (signedIn) {
                        DropdownMenuItem(
                            text = { Text(if (recording) "Остановить запись" else "Начать запись") },
                            enabled = !recordingBusy,
                            onClick = {
                                showMenu = false
                                scope.launch {
                                    try {
                                        if (recording) {
                                            recordingBusy = true
                                            val warning = vm.api.stopRecording(session.roomName, egressId)
                                            recording = false
                                            egressId = null
                                            vm.toast("Запись остановлена", warning)
                                            recordingBusy = false
                                        } else {
                                            startRecording()
                                            vm.toast("Запись началась")
                                        }
                                    } catch (caught: ApiException) {
                                        recordingBusy = false
                                        vm.toast("Ошибка записи", caught.message, isError = true)
                                    }
                                }
                            },
                        )
                    }
                }
            }
            FilledIconButton(
                onClick = { confirmLeave = true },
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = VclkColors.Danger, contentColor = Color.White),
            ) { Icon(Icons.Filled.CallEnd, contentDescription = "Выйти") }
        }
    }

    if (showChat) {
        ChatSheet(
            messages = messages.map { Triple(it.fromParticipant?.displayName() ?: "Участник", it.message, it.timestamp) },
            onDismiss = { showChat = false },
            onSend = { text ->
                scope.launch {
                    chat.send(text).onFailure { vm.toast("Сообщение не отправлено", it.message, isError = true) }
                }
            },
        )
    }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("Выйти из встречи?") },
            text = { Text("Вы покинете комнату. Остальные участники останутся в ней.") },
            confirmButton = { TextButton(onClick = { confirmLeave = false; vm.leaveRoom() }) { Text("Выйти") } },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Остаться") } },
        )
    }
}

@Composable
private fun RecBadge() {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(VclkColors.Rec).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(Color.White))
        Text("REC", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/** Режим «фокус»: одна основная плитка и остальные в превью (по числу плиток — одиночный / два / стопка). */
@Composable
private fun FocusStage(
    vm: AppViewModel,
    ordered: List<TrackReference>,
    main: TrackReference,
    serverUrl: String,
    frontFacing: Boolean,
    onSelect: (TrackReference) -> Unit,
) {
    val others = ordered.filter { it.tileId() != main.tileId() }
    when (mobileLayoutMode(ordered.size)) {
        MobileLayoutMode.Single -> ParticipantTile(vm, main, serverUrl, frontFacing, Modifier.fillMaxSize())
        MobileLayoutMode.Two -> Box(Modifier.fillMaxSize()) {
            ParticipantTile(vm, main, serverUrl, frontFacing, Modifier.fillMaxSize())
            others.firstOrNull()?.let { other ->
                ParticipantTile(
                    vm, other, serverUrl, frontFacing,
                    Modifier.align(Alignment.TopEnd).padding(8.dp).width(104.dp).height(148.dp),
                    compact = true,
                    onClick = { onSelect(other) },
                )
            }
        }
        MobileLayoutMode.Stack -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ParticipantTile(vm, main, serverUrl, frontFacing, Modifier.weight(1f).fillMaxWidth())
            LazyRow(Modifier.fillMaxWidth().height(104.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(others, key = { it.tileId() }) { other ->
                    ParticipantTile(
                        vm, other, serverUrl, frontFacing,
                        Modifier.width(80.dp).fillMaxHeight(),
                        compact = true,
                        onClick = { onSelect(other) },
                    )
                }
            }
        }
    }
}

/** Режим «сетка»: все плитки в два столбца. */
@Composable
private fun GridStage(
    vm: AppViewModel,
    ordered: List<TrackReference>,
    serverUrl: String,
    frontFacing: Boolean,
    onPick: (TrackReference) -> Unit,
) {
    val rows = ordered.chunked(2)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row ->
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { track ->
                    ParticipantTile(
                        vm, track, serverUrl, frontFacing,
                        Modifier.weight(1f).fillMaxHeight(),
                        compact = ordered.size > 4,
                        onClick = { onPick(track) },
                    )
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun ParticipantTile(
    vm: AppViewModel,
    trackRef: TrackReference,
    serverUrl: String,
    frontFacing: Boolean,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val participant = trackRef.participant
    val info = rememberParticipantInfo(participant)
    val speaking by participant::isSpeaking.flow.collectAsState()
    val muted by rememberTrackMuted(trackRef)
    val isScreen = trackRef.source == Track.Source.SCREEN_SHARE
    val isLocal = participant is LocalParticipant
    val hasVideo = trackRef.publication != null && !muted
    val avatar = rememberAvatar(vm, parseParticipantAvatarUrl(info.metadata, serverUrl))
    val name = (info.name?.takeIf { it.isNotBlank() } ?: info.identity?.value ?: "Участник") +
        if (isScreen) " — экран" else ""

    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(VclkColors.Surface)
            .border(
                BorderStroke(if (speaking) 2.dp else 1.dp, if (speaking) VclkColors.Success else VclkColors.Outline),
                RoundedCornerShape(14.dp),
            )
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        if (hasVideo) {
            VideoTrackView(
                trackReference = trackRef,
                modifier = Modifier.fillMaxSize(),
                mirror = isLocal && frontFacing && !isScreen,
                scaleType = if (isScreen) ScaleType.FitInside else ScaleType.Fill,
            )
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                val size = if (compact) 44.dp else 96.dp
                if (avatar != null) {
                    Image(
                        bitmap = avatar.asImageBitmap(),
                        contentDescription = name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(size).clip(CircleShape),
                    )
                } else {
                    Box(
                        Modifier.size(size).clip(CircleShape).background(VclkColors.SurfaceHigh),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            name.trim().take(1).uppercase(),
                            fontSize = if (compact) 18.sp else 36.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
        Text(
            if (isLocal) "$name (вы)" else name,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(6.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Color(0x99000000))
                .padding(horizontal = 6.dp, vertical = 2.dp),
            fontSize = if (compact) 10.sp else 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ParticipantsPanel(participants: List<Participant>, modifier: Modifier, onClose: () -> Unit) {
    Card(
        modifier = modifier.width(240.dp),
        colors = CardDefaults.cardColors(containerColor = VclkColors.SurfaceHigh),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Участники (${participants.size})", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                TextButton(onClick = onClose) { Text("Закрыть") }
            }
            LazyColumn(Modifier.height((participants.size.coerceAtMost(6) * 36).dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(participants, key = { it.identity?.value ?: it.hashCode().toString() }) { participant ->
                    val info = rememberParticipantInfo(participant)
                    val speaking by participant::isSpeaking.flow.collectAsState()
                    Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            (info.name?.takeIf { it.isNotBlank() } ?: info.identity?.value ?: "Участник") +
                                if (participant is LocalParticipant) " (вы)" else "",
                            Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (speaking) "говорит" else "в сети",
                            fontSize = 11.sp,
                            color = if (speaking) VclkColors.Success else VclkColors.Muted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatSheet(
    messages: List<Triple<String, String, Long>>,
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = VclkColors.Surface,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.8f).imePadding().padding(horizontal = 16.dp)) {
            Text("Сообщения", style = MaterialTheme.typography.titleMedium)
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().padding(vertical = 8.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (messages.isEmpty()) {
                    item { Text("Сообщений пока нет", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                items(messages.size) { index ->
                    val (author, text, timestamp) = messages[index]
                    Column {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(author, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text(
                                formatTime(Instant.ofEpochMilli(timestamp).toLocalDateTime()),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        LinkedText(text)
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Введите сообщение") },
                    maxLines = 3,
                )
                FilledIconButton(
                    onClick = {
                        if (isNonEmptyChatMessage(draft)) {
                            onSend(draft.trim())
                            draft = ""
                        }
                    },
                    enabled = isNonEmptyChatMessage(draft),
                ) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Отправить") }
            }
        }
    }
}
