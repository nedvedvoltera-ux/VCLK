package ru.asntl.vclk.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.asntl.vclk.AppViewModel
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.JoinTarget
import ru.asntl.vclk.data.Meeting
import ru.asntl.vclk.util.ATTACHMENT_MIME_TYPES
import ru.asntl.vclk.util.CalEvent
import ru.asntl.vclk.util.Recurrence
import ru.asntl.vclk.util.RU
import ru.asntl.vclk.util.calendarTitle
import ru.asntl.vclk.util.CalendarMode
import ru.asntl.vclk.util.formatDayMonth
import ru.asntl.vclk.util.formatTime
import ru.asntl.vclk.util.parseInstant
import ru.asntl.vclk.util.shiftAnchor
import ru.asntl.vclk.util.toLocalDateTime
import ru.asntl.vclk.util.upcomingDistinctSeries
import java.time.Instant
import java.time.LocalDate

private fun Meeting.displayTitle() = if (isRecurring) "↻ $title" else title

private fun Meeting.toCalEvent() = CalEvent(
    key = key,
    title = displayTitle(),
    start = parseInstant(starts_at).toLocalDateTime(),
    end = parseInstant(ends_at).toLocalDateTime(),
)

/** Основной экран после входа: «Обзор» и «Календарь» (разделы настроек администратора в приложении отсутствуют). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(vm: AppViewModel) {
    val user = vm.user ?: return
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var editorOpen by remember { mutableStateOf(false) }
    var editorMeeting by remember { mutableStateOf<Meeting?>(null) }
    var inviteFor by remember { mutableStateOf<Meeting?>(null) }
    var menuOpen by remember { mutableStateOf(false) }

    val events = remember(vm.meetings) { vm.meetings.filter { it.status == "scheduled" }.map { it.toCalEvent() } }
    fun openMeeting(key: String) {
        vm.meetings.firstOrNull { it.key == key }?.let {
            editorMeeting = it
            editorOpen = true
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("VCLK", fontWeight = FontWeight.Bold)
                        Text("Планировщик", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    IconButton(onClick = { vm.loadMeetings(); vm.refreshModes() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Обновить")
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.Person, contentDescription = "Профиль") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(user.displayName, fontWeight = FontWeight.Medium)
                                        Text(
                                            if (user.isAdmin) "Администратор" else "Пользователь",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                },
                                onClick = {},
                                enabled = false,
                            )
                            DropdownMenuItem(text = { Text("Выйти") }, onClick = { menuOpen = false; vm.logout() })
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                    label = { Text("Обзор") },
                )
                NavigationBarItem(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    icon = { Icon(Icons.Filled.CalendarMonth, contentDescription = null) },
                    label = { Text("Календарь") },
                )
            }
        },
        floatingActionButton = {
            if (vm.modes.calendarMode) {
                ExtendedFloatingActionButton(
                    onClick = { editorMeeting = null; editorOpen = true },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("Запланировать") },
                )
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (tab == 0) {
                OverviewTab(
                    vm = vm,
                    events = events,
                    onOpen = { editorMeeting = it; editorOpen = true },
                    onInvite = { inviteFor = it },
                    onOpenCalendar = { tab = 1 },
                    onEventClick = ::openMeeting,
                )
            } else {
                Column(Modifier.fillMaxSize()) {
                    Text(
                        "Календарь встреч",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                    CalendarScreen(events = events, onEventClick = ::openMeeting, modifier = Modifier.weight(1f))
                }
            }
        }
    }

    if (editorOpen) {
        androidx.compose.runtime.key(editorMeeting?.key ?: "new") {
            MeetingDialog(
                initial = editorMeeting,
                vm = vm,
                onClose = { editorOpen = false; editorMeeting = null },
            )
        }
    }
    inviteFor?.let { InviteDialog(meeting = it, vm = vm, onClose = { inviteFor = null }) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OverviewTab(
    vm: AppViewModel,
    events: List<CalEvent>,
    onOpen: (Meeting) -> Unit,
    onInvite: (Meeting) -> Unit,
    onOpenCalendar: () -> Unit,
    onEventClick: (String) -> Unit,
) {
    val user = vm.user ?: return
    val now = Instant.now()
    val upcoming = remember(vm.meetings) {
        upcomingDistinctSeries(
            items = vm.meetings,
            now = now,
            limit = 6,
            idOf = { it.id },
            endsAtOf = { parseInstant(it.ends_at) },
            isScheduled = { it.status == "scheduled" },
        )
    }
    val today = LocalDate.now()
    val todayCount = vm.meetings.count {
        it.status == "scheduled" && parseInstant(it.starts_at).toLocalDateTime().toLocalDate() == today
    }
    var monthAnchor by rememberSaveable { mutableStateOf(today.withDayOfMonth(1).toEpochDay()) }
    val scope = rememberCoroutineScope()
    var uploadTarget by remember { mutableStateOf<Meeting?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        val meeting = uploadTarget
        uploadTarget = null
        if (uri == null || meeting == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                vm.uploadAttachment(meeting.id, uri, meeting.attachments.size)
                vm.loadMeetings()
                vm.toast("Файл прикреплён")
            } catch (caught: ApiException) {
                vm.toast("Не удалось загрузить файл", caught.message, isError = true)
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "РАБОЧЕЕ ПРОСТРАНСТВО",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text("Добрый день, ${user.displayName}", style = MaterialTheme.typography.headlineSmall)
                if (vm.modes.freeMode) {
                    OutlinedButton(onClick = { vm.openWaiting(JoinTarget()) }, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Свободная комната")
                    }
                }
                vm.loadError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                StatCard("Ближайшие встречи", upcoming.size.toString(), if (user.isAdmin) "во всей организации" else "доступно вам", Modifier.weight(1f))
                StatCard("Сегодня", todayCount.toString(), "встречи в календаре", Modifier.weight(1f))
                StatCard("Ваш доступ", if (user.isAdmin) "Admin" else "User", "роль в системе", Modifier.weight(1f))
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Ближайшие встречи", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onOpenCalendar) { Text("Открыть календарь") }
            }
        }
        if (upcoming.isEmpty()) {
            item { Text("Запланированных встреч пока нет.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            items(upcoming.size) { index ->
                val meeting = upcoming[index]
                val canManage = user.isAdmin || meeting.organizer_id == user.id
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.width(64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(formatDayMonth(meeting.starts_at), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                                Text(formatTime(meeting.starts_at), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(meeting.displayTitle(), style = MaterialTheme.typography.titleMedium)
                                val period = Recurrence.from(meeting.recurrence).takeIf { it != Recurrence.None }?.label?.lowercase()
                                Text(
                                    "${meeting.organizer_name} · ${meeting.participants.size} участников" + (period?.let { " · $it" } ?: ""),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (meeting.description.isNotBlank()) LinkedText(meeting.description.trim())
                                meeting.attachments.forEach { attachment ->
                                    Text(
                                        attachment.original_name,
                                        color = MaterialTheme.colorScheme.primary,
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(top = 2.dp).clickableNoRipple { vm.openAttachment(attachment) },
                                    )
                                }
                            }
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            OutlinedButton(onClick = { onOpen(meeting) }) { Text("Открыть") }
                            if (canManage) {
                                OutlinedButton(onClick = { onInvite(meeting) }) { Text("Пригласить") }
                                OutlinedButton(onClick = {
                                    uploadTarget = meeting
                                    picker.launch(ATTACHMENT_MIME_TYPES)
                                }) { Text("Файл") }
                            }
                            Button(onClick = { vm.openWaiting(JoinTarget(meetingId = meeting.id, title = meeting.title)) }) {
                                Text("Подключиться")
                            }
                        }
                    }
                }
            }
        }
        item {
            val anchor = LocalDate.ofEpochDay(monthAnchor)
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(8.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Календарь месяца", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp).weight(1f))
                        TextButton(onClick = onOpenCalendar) { Text("Развернуть") }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { monthAnchor = shiftAnchor(CalendarMode.Month, anchor, -1).toEpochDay() }) {
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Назад")
                        }
                        Text(
                            calendarTitle(CalendarMode.Month, anchor),
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.titleSmall,
                        )
                        IconButton(onClick = { monthAnchor = shiftAnchor(CalendarMode.Month, anchor, 1).toEpochDay() }) {
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Вперёд")
                        }
                    }
                    MonthGrid(
                        anchor = anchor,
                        events = events,
                        compact = true,
                        onDayClick = { onOpenCalendar() },
                        onEventClick = onEventClick,
                    )
                }
            }
        }
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.then(Modifier.clickable(onClick = onClick))

@Composable
private fun StatCard(label: String, value: String, hint: String, modifier: Modifier = Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(hint, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
}
