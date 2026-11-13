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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import ru.asntl.vclk.AppViewModel
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.Attachment
import ru.asntl.vclk.data.JoinTarget
import ru.asntl.vclk.data.Meeting
import ru.asntl.vclk.data.MeetingPayload
import ru.asntl.vclk.data.Recipient
import ru.asntl.vclk.util.ATTACHMENT_MIME_TYPES
import ru.asntl.vclk.util.MAX_ATTACHMENTS
import ru.asntl.vclk.util.MAX_ATTACHMENT_BYTES
import ru.asntl.vclk.util.REMINDER_OPTIONS
import ru.asntl.vclk.util.Recurrence
import ru.asntl.vclk.util.defaultMeetingStart
import ru.asntl.vclk.util.formatDateTime
import ru.asntl.vclk.util.humanFileSize
import ru.asntl.vclk.util.parseInstant
import ru.asntl.vclk.util.reminderLabel
import ru.asntl.vclk.util.shiftSeriesTime
import ru.asntl.vclk.util.toInstant
import ru.asntl.vclk.util.toIsoString
import ru.asntl.vclk.util.toLocalDateTime
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private data class PickedFile(val uri: Uri, val name: String, val size: Long)

private data class MeetingForm(
    val title: String,
    val description: String,
    val start: LocalDateTime,
    val endTime: LocalTime,
    val participants: List<String>,
    val recording: Boolean,
    val reminder: Int,
    val recurrence: Recurrence,
)

private fun blankForm(): MeetingForm {
    val start = defaultMeetingStart()
    return MeetingForm("", "", start, start.plusHours(1).toLocalTime(), emptyList(), false, 15, Recurrence.None)
}

private fun formFrom(meeting: Meeting) = MeetingForm(
    title = meeting.title,
    description = meeting.description,
    start = parseInstant(meeting.starts_at).toLocalDateTime(),
    endTime = parseInstant(meeting.ends_at).toLocalDateTime().toLocalTime(),
    participants = meeting.participants.map { it.email },
    recording = meeting.recording_enabled,
    reminder = meeting.reminder_minutes ?: 15,
    recurrence = Recurrence.from(meeting.recurrence),
)

/** Карточка встречи: просмотр / правка / создание. `initial == null` — новая встреча. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MeetingDialog(initial: Meeting?, vm: AppViewModel, onClose: () -> Unit) {
    val user = vm.user
    val canManage = initial != null && user != null && (user.isAdmin || initial.organizer_id == user.id)
    var editing by remember { mutableStateOf(initial == null) }
    var form by remember { mutableStateOf(initial?.let(::formFrom) ?: blankForm()) }
    var pendingFiles by remember { mutableStateOf<List<PickedFile>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickParticipants by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val existingCount = initial?.attachments?.size ?: 0

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = vm.api.fileName(uri)
        val size = vm.api.fileSize(uri)
        when {
            ru.asntl.vclk.util.attachmentMimeType(name) == null ->
                error = "Допустимы только PDF, Office-документы, TXT, CSV, PNG и JPEG"
            size > MAX_ATTACHMENT_BYTES -> error = "«$name» больше 20 МБ"
            existingCount + pendingFiles.size >= MAX_ATTACHMENTS ->
                error = "К встрече можно прикрепить не более $MAX_ATTACHMENTS файлов"
            else -> {
                pendingFiles = pendingFiles + PickedFile(uri, name, size)
                error = null
            }
        }
    }

    fun save() {
        if (saving) return
        val start = form.start
        val end = LocalDateTime.of(start.toLocalDate(), form.endTime)
        when {
            form.title.isBlank() -> { error = "Укажите тему встречи"; return }
            !end.isAfter(start) -> { error = "Время окончания должно быть позже начала"; return }
        }
        var startsAt = start.toInstant()
        var endsAt = end.toInstant()
        // Правка одного вхождения серии сдвигает всю серию на ту же разницу.
        if (initial?.series_starts_at != null && initial.series_ends_at != null) {
            startsAt = shiftSeriesTime(parseInstant(initial.series_starts_at), parseInstant(initial.starts_at), startsAt)
            endsAt = shiftSeriesTime(parseInstant(initial.series_ends_at), parseInstant(initial.ends_at), endsAt)
        }
        val payload = MeetingPayload(
            title = form.title.trim(),
            description = form.description,
            startsAt = startsAt.toIsoString(),
            endsAt = endsAt.toIsoString(),
            timezone = ZoneId.systemDefault().id,
            recordingEnabled = form.recording,
            reminderMinutes = form.reminder,
            recurrence = form.recurrence.value,
            participantEmails = form.participants,
        )
        saving = true
        error = null
        scope.launch {
            try {
                val saved = vm.saveMeeting(initial?.id, payload)
                var uploaded = 0
                for (file in pendingFiles) {
                    vm.uploadAttachment(saved.id, file.uri, existingCount + uploaded)
                    uploaded += 1
                }
                if (initial == null) {
                    form.participants.forEach { email -> runCatching { vm.invite(saved.id, email) } }
                }
                vm.toast(if (initial == null) "Встреча создана" else "Встреча сохранена")
                onClose()
            } catch (caught: ApiException) {
                error = caught.message
            } finally {
                saving = false
            }
        }
    }

    fun remove() {
        if (initial == null) return
        deleting = true
        scope.launch {
            try {
                vm.deleteMeeting(initial.id)
                confirmDelete = false
                vm.toast("Встреча удалена")
                onClose()
            } catch (caught: ApiException) {
                confirmDelete = false
                error = caught.message
            } finally {
                deleting = false
            }
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
                // Заголовок
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            initial == null -> "Запланировать встречу"
                            editing -> "Изменить встречу"
                            else -> initial.title
                        },
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (initial != null && !editing && canManage) {
                        IconButton(onClick = { editing = true }) { Icon(Icons.Filled.Edit, contentDescription = "Редактировать") }
                        IconButton(onClick = { confirmDelete = true }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Удалить", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    if (initial != null && !editing) {
                        MeetingView(initial, vm)
                    } else {
                        MeetingEditForm(
                            form = form,
                            onChange = { form = it },
                            isSeriesOccurrence = initial?.series_starts_at != null,
                            existingAttachments = initial?.attachments.orEmpty(),
                            pendingFiles = pendingFiles,
                            onRemoveFile = { index -> pendingFiles = pendingFiles.filterIndexed { i, _ -> i != index } },
                            onPickFile = { filePicker.launch(ATTACHMENT_MIME_TYPES) },
                            onPickParticipants = { pickParticipants = true },
                            onOpenAttachment = vm::openAttachment,
                        )
                    }
                    if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
                }
                // Кнопки
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (initial != null && !editing) {
                        OutlinedButton(onClick = onClose) { Text("Закрыть") }
                        if (canManage) FilledTonalButton(onClick = { editing = true }) { Text("Изменить") }
                        Button(onClick = {
                            vm.openWaiting(JoinTarget(meetingId = initial.id, title = initial.title))
                            onClose()
                        }) { Text("Подключиться") }
                    } else {
                        OutlinedButton(
                            enabled = !saving,
                            onClick = {
                                if (initial == null) onClose() else {
                                    form = formFrom(initial)
                                    pendingFiles = emptyList()
                                    error = null
                                    editing = false
                                }
                            },
                        ) { Text(if (initial == null) "Отмена" else "К просмотру") }
                        Button(onClick = ::save, enabled = !saving) {
                            if (saving) CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp)
                            else Text(if (initial == null) "Создать и пригласить" else "Сохранить")
                        }
                    }
                }
            }
        }
    }

    if (pickParticipants) {
        ParticipantsPicker(
            recipients = vm.recipients,
            selected = form.participants,
            onDismiss = { pickParticipants = false },
            onConfirm = {
                form = form.copy(participants = it)
                pickParticipants = false
            },
        )
    }

    if (confirmDelete && initial != null) {
        AlertDialog(
            onDismissRequest = { if (!deleting) confirmDelete = false },
            title = { Text("Удалить встречу?") },
            text = {
                Text(
                    "«${initial.title}» будет отменена и исчезнет из календаря. Участники больше не смогут к ней подключиться." +
                        if (initial.isRecurring) " Будет удалена вся серия повторяющихся встреч." else "",
                )
            },
            confirmButton = {
                TextButton(onClick = ::remove, enabled = !deleting) {
                    Text(if (deleting) "Удаление…" else "Удалить", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }, enabled = !deleting) { Text("Отмена") } },
        )
    }
}

@Composable
private fun MeetingView(meeting: Meeting, vm: AppViewModel) {
    LabeledValue("Время") {
        Text("${formatDateTime(meeting.starts_at)} — ${formatDateTime(meeting.ends_at)}")
        Recurrence.from(meeting.recurrence).takeIf { it != Recurrence.None }?.let {
            Text(
                "Повторяется: ${it.label.lowercase()} в то же время",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    LabeledValue("Организатор") { Text(meeting.organizer_name) }
    if (meeting.description.isNotBlank()) {
        LabeledValue("Описание") { LinkedText(meeting.description.trim()) }
    }
    LabeledValue("Участники") {
        Text(
            if (meeting.participants.isEmpty()) "Пока никого не пригласили"
            else meeting.participants.joinToString(", ") { it.display_name ?: it.email },
        )
    }
    if (meeting.attachments.isNotEmpty()) {
        LabeledValue("Вложения") {
            meeting.attachments.forEach { attachment ->
                Text(
                    attachment.original_name,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { vm.openAttachment(attachment) }.padding(vertical = 4.dp),
                )
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        LabeledValue("Напоминание", Modifier.weight(1f)) { Text(reminderLabel(meeting.reminder_minutes)) }
        LabeledValue("Запись", Modifier.weight(1f)) { Text(if (meeting.recording_enabled) "Включена" else "Выключена") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MeetingEditForm(
    form: MeetingForm,
    onChange: (MeetingForm) -> Unit,
    isSeriesOccurrence: Boolean,
    existingAttachments: List<Attachment>,
    pendingFiles: List<PickedFile>,
    onRemoveFile: (Int) -> Unit,
    onPickFile: () -> Unit,
    onPickParticipants: () -> Unit,
    onOpenAttachment: (Attachment) -> Unit,
) {
    var datePicker by remember { mutableStateOf(false) }
    var startPicker by remember { mutableStateOf(false) }
    var endPicker by remember { mutableStateOf(false) }

    OutlinedTextField(
        value = form.title,
        onValueChange = { if (it.length <= 160) onChange(form.copy(title = it)) },
        label = { Text("Тема встречи") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = form.description,
        onValueChange = { onChange(form.copy(description = it)) },
        label = { Text("Описание") },
        minLines = 3,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        PickerField("Дата", DateTimeFormatter.ofPattern("d MMM yyyy", ru.asntl.vclk.util.RU).format(form.start), Modifier.weight(1.4f)) { datePicker = true }
        PickerField("Начало", form.start.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")), Modifier.weight(1f)) { startPicker = true }
        PickerField("Окончание", form.endTime.format(DateTimeFormatter.ofPattern("HH:mm")), Modifier.weight(1f)) { endPicker = true }
    }

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Повторяющаяся встреча")
            if (isSeriesOccurrence) {
                Text("Изменения применятся ко всей серии", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(
            checked = form.recurrence != Recurrence.None,
            onCheckedChange = { onChange(form.copy(recurrence = if (it) Recurrence.Weekly else Recurrence.None)) },
        )
    }
    if (form.recurrence != Recurrence.None) {
        SimpleDropdown(
            label = "Период",
            supporting = "В то же время, что и эта встреча",
            options = Recurrence.periods.map { it to it.label },
            selected = form.recurrence,
            onSelect = { onChange(form.copy(recurrence = it)) },
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Участники", style = MaterialTheme.typography.labelLarge)
        Text("Выберите зарегистрированных пользователей", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            form.participants.forEach { email ->
                InputChip(
                    selected = true,
                    onClick = { onChange(form.copy(participants = form.participants - email)) },
                    label = { Text(email, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
        }
        OutlinedButton(onClick = onPickParticipants) { Text("Выбрать участников") }
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Вложения", style = MaterialTheme.typography.labelLarge)
        Text(
            "PDF, Office, TXT/CSV, PNG/JPEG — до 20 МБ, не более 10 файлов на встречу.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        existingAttachments.forEach { attachment ->
            Text(
                attachment.original_name,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable { onOpenAttachment(attachment) }.padding(vertical = 4.dp),
            )
        }
        pendingFiles.forEachIndexed { index, file ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${file.name} (${humanFileSize(maxOf(file.size, 0))})",
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                TextButton(onClick = { onRemoveFile(index) }) { Text("Убрать") }
            }
        }
        FilledTonalButton(onClick = onPickFile) { Text("Прикрепить файл") }
    }

    SimpleDropdown(
        label = "Напоминание",
        options = REMINDER_OPTIONS.map { it.first to it.second },
        selected = form.reminder,
        onSelect = { onChange(form.copy(reminder = it)) },
    )
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Записывать встречу", modifier = Modifier.weight(1f))
        Switch(checked = form.recording, onCheckedChange = { onChange(form.copy(recording = it)) })
    }

    if (datePicker) {
        DateDialog(
            initial = form.start.toLocalDate(),
            onDismiss = { datePicker = false },
            onConfirm = { date ->
                datePicker = false
                onChange(form.copy(start = LocalDateTime.of(date, form.start.toLocalTime())))
            },
        )
    }
    if (startPicker) {
        TimeDialog(
            initial = form.start.toLocalTime(),
            onDismiss = { startPicker = false },
            onConfirm = { time ->
                startPicker = false
                onChange(form.copy(start = LocalDateTime.of(form.start.toLocalDate(), time)))
            },
        )
    }
    if (endPicker) {
        TimeDialog(
            initial = form.endTime,
            onDismiss = { endPicker = false },
            onConfirm = { time ->
                endPicker = false
                onChange(form.copy(endTime = time))
            },
        )
    }
}

@Composable
private fun PickerField(label: String, value: String, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(label, maxLines = 1) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Box(Modifier.matchParentSize().clickable(onClick = onClick))
    }
}

@Composable
private fun <T> SimpleDropdown(
    label: String,
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    supporting: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == selected }?.second.orEmpty(),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            supportingText = supporting?.let { { Text(it) } },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
            modifier = Modifier.fillMaxWidth(),
        )
        Box(Modifier.matchParentSize().clickable { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(value); open = false })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateDialog(initial: LocalDate, onDismiss: () -> Unit, onConfirm: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onConfirm(java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) } ?: onDismiss()
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    ) { DatePicker(state = state) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeDialog(initial: LocalTime, onDismiss: () -> Unit, onConfirm: (LocalTime) -> Unit) {
    val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onConfirm(LocalTime.of(state.hour, state.minute)) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
        text = { TimePicker(state = state) },
    )
}

@Composable
private fun ParticipantsPicker(
    recipients: List<Recipient>,
    selected: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (List<String>) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf(selected.toSet()) }
    val filtered = remember(query, recipients) {
        recipients.filter { it.displayName.contains(query, ignoreCase = true) || it.email.contains(query, ignoreCase = true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Участники") },
        text = {
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Поиск") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(filtered, key = { it.id }) { recipient ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                chosen = if (recipient.email in chosen) chosen - recipient.email else chosen + recipient.email
                            },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = recipient.email in chosen,
                                onCheckedChange = {
                                    chosen = if (it) chosen + recipient.email else chosen - recipient.email
                                },
                            )
                            Column {
                                Text(recipient.displayName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    recipient.email,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                // Сохраняем порядок: сначала ранее выбранные, затем новые.
                val kept = selected.filter { it in chosen }
                onConfirm(kept + chosen.filter { it !in kept })
            }) { Text("Готово") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}

/** Создаёт персональное приглашение и копирует ссылку в буфер обмена. */
@Composable
fun InviteDialog(meeting: Meeting, vm: AppViewModel, onClose: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(meeting.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Укажите адрес участника. Ему будет отправлена ссылка и событие Outlook при настроенной почте.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("E-mail получателя") },
                    placeholder = { Text("user@company.ru") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !sending && email.contains("@"),
                onClick = {
                    sending = true
                    error = null
                    scope.launch {
                        try {
                            val response = vm.invite(meeting.id, email)
                            clipboard.setText(AnnotatedString(response.inviteUrl))
                            vm.toast("Приглашение готово", response.warning ?: "Приглашение создано, ссылка скопирована в буфер обмена.")
                            onClose()
                        } catch (caught: ApiException) {
                            error = caught.message
                        } finally {
                            sending = false
                        }
                    }
                },
            ) { Text(if (sending) "Отправка…" else "Создать приглашение") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Отмена") } },
    )
}
