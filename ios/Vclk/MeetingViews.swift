import QuickLook
import SwiftUI
import UIKit

private struct MeetingForm {
    var title = ""
    var description = ""
    var start: Date
    var endTime: Date
    var participants: [String] = []
    var recording = false
    var reminder = 15
    var recurrence = Recurrence.none

    static func blank() -> MeetingForm {
        let start = defaultMeetingStart()
        return MeetingForm(start: start, endTime: start.addingTimeInterval(3600))
    }

    init(start: Date, endTime: Date) {
        self.start = start
        self.endTime = endTime
    }

    init(meeting: Meeting) {
        title = meeting.title
        description = meeting.description
        start = parseInstant(meeting.starts_at)
        endTime = parseInstant(meeting.ends_at)
        participants = meeting.participants.map { $0.email }
        recording = meeting.recording_enabled
        reminder = meeting.reminder_minutes ?? 15
        recurrence = Recurrence.from(meeting.recurrence)
    }

    /// Окончание — то же число, что и начало, с выбранным временем.
    var end: Date {
        let calendar = Calendar.current
        let time = calendar.dateComponents([.hour, .minute], from: endTime)
        var day = calendar.dateComponents([.year, .month, .day], from: start)
        day.hour = time.hour
        day.minute = time.minute
        day.second = 0
        return calendar.date(from: day) ?? endTime
    }
}

/// Карточка встречи: просмотр / правка / создание. `initial == nil` — новая встреча.
@MainActor
struct MeetingSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let initial: Meeting?

    @State private var editing: Bool
    @State private var form: MeetingForm
    @State private var pendingFiles: [PickedFile] = []
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var error: String?
    @State private var newParticipant = ""
    @State private var showImporter = false
    @State private var previewURL: URL?

    init(initial: Meeting?) {
        self.initial = initial
        _editing = State(initialValue: initial == nil)
        _form = State(initialValue: initial.map { MeetingForm(meeting: $0) } ?? MeetingForm.blank())
    }

    private var canManage: Bool {
        guard let initial, let user = model.user else { return false }
        return user.isAdmin || initial.organizer_id == user.id
    }

    private var existingCount: Int { initial?.attachments.count ?? 0 }

    var body: some View {
        NavigationStack {
            Group {
                if editing { editForm } else if let initial { details(initial) }
            }
            .navigationTitle(initial == nil ? "Новая встреча" : (editing ? "Правка встречи" : "Встреча"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(editing && initial != nil ? "Отмена" : "Закрыть") {
                        if editing, let initial {
                            form = MeetingForm(meeting: initial)
                            pendingFiles = []
                            error = nil
                            editing = false
                        } else {
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if editing {
                        Button(saving ? "Сохранение…" : "Сохранить", action: save).disabled(saving)
                    } else if canManage {
                        Button("Изменить") { editing = true }
                    }
                }
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: attachmentContentTypes) { result in
            guard case .success(let url) = result else { return }
            addPending(url)
        }
        .quickLookPreview($previewURL)
        .confirmationDialog("Удалить встречу?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive, action: remove)
            Button("Отмена", role: .cancel) {}
        } message: {
            Text(initial?.isRecurring == true ? "Будет удалена вся серия повторяющихся встреч." : "Действие нельзя отменить.")
        }
    }

    // MARK: - Просмотр

    private func details(_ meeting: Meeting) -> some View {
        Form {
            Section {
                Text(meeting.displayTitle).font(.title3.weight(.semibold))
                if !meeting.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    LinkedText(text: meeting.description)
                }
            }
            Section {
                LabeledContent("Начало", value: formatDateTime(meeting.starts_at))
                LabeledContent("Окончание", value: formatDateTime(meeting.ends_at))
                LabeledContent("Повтор", value: Recurrence.from(meeting.recurrence).label)
                LabeledContent("Организатор", value: meeting.organizer_name)
                LabeledContent("Напоминание", value: reminderLabel(meeting.reminder_minutes))
                LabeledContent("Запись", value: meeting.recording_enabled ? "Включена" : "Выключена")
            }
            if !meeting.participants.isEmpty {
                Section("Участники") {
                    ForEach(meeting.participants, id: \.email) { participant in
                        VStack(alignment: .leading) {
                            Text(participant.display_name?.isEmpty == false ? participant.display_name ?? "" : participant.email)
                            Text(participant.email).font(.footnote).foregroundColor(Theme.muted)
                        }
                    }
                }
            }
            if !meeting.attachments.isEmpty {
                Section("Файлы") {
                    ForEach(meeting.attachments, id: \.id) { attachment in
                        Button {
                            Task { previewURL = await model.downloadAttachment(attachment) }
                        } label: {
                            Label("\(attachment.original_name) · \(humanFileSize(attachment.size_bytes))", systemImage: "paperclip")
                        }
                    }
                }
            }
            Section {
                Button("Подключиться") {
                    let target = JoinTarget(meetingId: meeting.id, title: meeting.title)
                    dismiss()
                    model.openWaiting(target)
                }
                if canManage {
                    Button("Удалить встречу", role: .destructive) { confirmDelete = true }
                }
            }
            if let error { Section { ErrorText(message: error) } }
        }
    }

    // MARK: - Правка

    private var editForm: some View {
        Form {
            Section {
                TextField("Тема встречи", text: $form.title)
                TextField("Описание", text: $form.description, axis: .vertical).lineLimit(2...6)
            }
            Section("Время") {
                DatePicker("Дата и начало", selection: $form.start)
                DatePicker("Окончание", selection: $form.endTime, displayedComponents: .hourAndMinute)
                Toggle("Повторять", isOn: Binding(
                    get: { form.recurrence != .none },
                    set: { form.recurrence = $0 ? .weekly : .none }
                ))
                if form.recurrence != .none {
                    Picker("Период", selection: $form.recurrence) {
                        ForEach(Recurrence.periods, id: \.self) { Text($0.label).tag($0) }
                    }
                    Text("Повторяется в то же время. Правка вхождения сдвигает всю серию.")
                        .font(.footnote)
                        .foregroundColor(Theme.muted)
                }
            }
            Section("Участники") {
                ForEach(form.participants, id: \.self) { email in
                    HStack {
                        Text(email)
                        Spacer()
                        Button {
                            form.participants.removeAll { $0 == email }
                        } label: { Image(systemName: "xmark.circle.fill").foregroundColor(Theme.muted) }
                            .buttonStyle(.plain)
                    }
                }
                HStack {
                    TextField("e-mail участника", text: $newParticipant)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(addParticipant)
                    Button("Добавить", action: addParticipant)
                        .disabled(newParticipant.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                let available = model.recipients.filter { recipient in
                    !form.participants.contains { $0.lowercased() == recipient.email.lowercased() }
                }
                if !available.isEmpty {
                    Menu("Выбрать из пользователей") {
                        ForEach(available, id: \.id) { recipient in
                            Button(recipient.displayName.isEmpty ? recipient.email : "\(recipient.displayName) — \(recipient.email)") {
                                form.participants.append(recipient.email)
                            }
                        }
                    }
                }
            }
            Section("Файлы") {
                if let initial {
                    ForEach(initial.attachments, id: \.id) { attachment in
                        Label(attachment.original_name, systemImage: "paperclip")
                    }
                }
                ForEach(pendingFiles) { file in
                    HStack {
                        Label("\(file.name) · \(humanFileSize(file.size))", systemImage: "doc.badge.plus")
                        Spacer()
                        Button {
                            pendingFiles.removeAll { $0.id == file.id }
                        } label: { Image(systemName: "xmark.circle.fill").foregroundColor(Theme.muted) }
                            .buttonStyle(.plain)
                    }
                }
                Button("Добавить файл") { showImporter = true }
                Text("PDF, Office, TXT, CSV, PNG, JPEG — до 20 МБ, не больше \(maxAttachments) файлов.")
                    .font(.footnote)
                    .foregroundColor(Theme.muted)
            }
            Section {
                Picker("Напоминание", selection: $form.reminder) {
                    ForEach(reminderOptions, id: \.minutes) { Text($0.label).tag($0.minutes) }
                }
                Toggle("Запись встречи", isOn: $form.recording)
            }
            if let error { Section { ErrorText(message: error) } }
        }
    }

    // MARK: - Действия

    private func addParticipant() {
        let email = newParticipant.trimmingCharacters(in: .whitespaces)
        guard !email.isEmpty else { return }
        if email.contains("@") && email.contains(".") {
            if !form.participants.contains(where: { $0.lowercased() == email.lowercased() }) {
                form.participants.append(email)
            }
            newParticipant = ""
            error = nil
        } else {
            error = "Введите корректный e-mail участника"
        }
    }

    private func addPending(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let size = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        if attachmentMimeType(name) == nil {
            error = "Допустимы только PDF, Office-документы, TXT, CSV, PNG и JPEG"
        } else if size > maxAttachmentBytes {
            error = "«\(name)» больше 20 МБ"
        } else if existingCount + pendingFiles.count >= maxAttachments {
            error = "К встрече можно прикрепить не более \(maxAttachments) файлов"
        } else {
            pendingFiles.append(PickedFile(url: url, name: name, size: size))
            error = nil
        }
    }

    private func save() {
        if saving { return }
        let start = form.start
        let end = form.end
        if form.title.trimmingCharacters(in: .whitespaces).isEmpty {
            error = "Укажите тему встречи"
            return
        }
        if end <= start {
            error = "Время окончания должно быть позже начала"
            return
        }
        var startsAt = start
        var endsAt = end
        // Правка одного вхождения серии сдвигает всю серию на ту же разницу.
        if let initial, let seriesStart = initial.series_starts_at, let seriesEnd = initial.series_ends_at {
            startsAt = shiftSeriesTime(seriesTime: parseInstant(seriesStart), occurrenceTime: parseInstant(initial.starts_at), newTime: start)
            endsAt = shiftSeriesTime(seriesTime: parseInstant(seriesEnd), occurrenceTime: parseInstant(initial.ends_at), newTime: end)
        }
        let payload = MeetingPayload(
            title: form.title.trimmingCharacters(in: .whitespaces),
            description: form.description,
            startsAt: toIsoString(startsAt),
            endsAt: toIsoString(endsAt),
            timezone: TimeZone.current.identifier,
            recordingEnabled: form.recording,
            reminderMinutes: form.reminder,
            recurrence: form.recurrence.rawValue,
            participantEmails: form.participants
        )
        saving = true
        error = nil
        let creating = initial == nil
        let files = pendingFiles
        let participants = form.participants
        let baseCount = existingCount
        Task {
            do {
                let saved = try await model.saveMeeting(id: initial?.id, payload: payload)
                var uploaded = 0
                for file in files {
                    try await model.uploadAttachment(meetingId: saved.id, file: file.url, existingCount: baseCount + uploaded)
                    uploaded += 1
                }
                if uploaded > 0 { model.loadMeetings() }
                if creating {
                    for email in participants {
                        _ = try? await model.invite(meetingId: saved.id, email: email)
                    }
                }
                model.showToast(creating ? "Встреча создана" : "Встреча сохранена")
                dismiss()
            } catch {
                self.error = errorText(error)
            }
            saving = false
        }
    }

    private func remove() {
        guard let initial else { return }
        Task {
            do {
                try await model.deleteMeeting(id: initial.id)
                model.showToast("Встреча удалена")
                dismiss()
            } catch {
                self.error = errorText(error)
            }
        }
    }
}

/// Персональное приглашение участнику: создаёт ссылку и копирует её в буфер обмена.
@MainActor
struct InviteSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let meeting: Meeting

    @State private var email = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(meeting.displayTitle).font(.headline)
                    TextField("e-mail участника", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Укажите адрес участника. Ему будет отправлена ссылка и событие Outlook при настроенной почте.")
                        .font(.footnote)
                        .foregroundColor(Theme.muted)
                }
                if let error { Section { ErrorText(message: error) } }
                Section {
                    Button(busy ? "Создание…" : "Создать приглашение", action: create)
                        .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("Пригласить")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Закрыть") { dismiss() } }
            }
        }
    }

    private func create() {
        busy = true
        error = nil
        Task {
            do {
                let response = try await model.invite(meetingId: meeting.id, email: email)
                if let link = response.inviteUrl { UIPasteboard.general.string = link }
                model.showToast("Приглашение готово", response.warning ?? "Приглашение создано, ссылка скопирована в буфер обмена.")
                dismiss()
            } catch {
                self.error = errorText(error)
            }
            busy = false
        }
    }
}
