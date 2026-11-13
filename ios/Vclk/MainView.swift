import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct EditorRoute: Identifiable {
    let id = UUID()
    let meeting: Meeting?
}

struct InviteRoute: Identifiable {
    let id = UUID()
    let meeting: Meeting
}

/// Допустимые типы вложений (то же, что в вебе).
let attachmentContentTypes: [UTType] = {
    var types: [UTType] = [.pdf, .plainText, .commaSeparatedText, .png, .jpeg]
    for ext in ["docx", "xlsx", "pptx"] {
        if let type = UTType(filenameExtension: ext) { types.append(type) }
    }
    return types
}()

extension Meeting {
    var calEvent: CalEvent {
        CalEvent(key: key, title: displayTitle, start: parseInstant(starts_at), end: parseInstant(ends_at))
    }
}

@MainActor
struct MainView: View {
    @EnvironmentObject var model: AppModel
    @State private var tab = 0
    @State private var editor: EditorRoute?
    @State private var inviteRoute: InviteRoute?
    @State private var showLinkPrompt = false
    @State private var linkText = ""

    private var events: [CalEvent] {
        model.meetings.filter { $0.status == "scheduled" }.map { $0.calEvent }
    }

    var body: some View {
        NavigationStack {
            TabView(selection: $tab) {
                OverviewView(
                    events: events,
                    onOpen: { editor = EditorRoute(meeting: $0) },
                    onInvite: { inviteRoute = InviteRoute(meeting: $0) },
                    onOpenCalendar: { tab = 1 },
                    onEventClick: openMeeting
                )
                .tabItem { Label("Обзор", systemImage: "house") }
                .tag(0)

                CalendarView(events: events, onEventClick: openMeeting)
                    .tabItem { Label("Календарь", systemImage: "calendar") }
                    .tag(1)
            }
            .navigationTitle("VCLK")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button {
                        model.loadMeetings()
                        model.refreshModes()
                    } label: { Image(systemName: "arrow.clockwise") }
                    Menu {
                        if let user = model.user {
                            Text(user.displayName)
                            Text(user.isAdmin ? "Администратор" : "Пользователь")
                        }
                        Button("Открыть по ссылке…") { showLinkPrompt = true }
                        Button("Сменить сервер") { model.changeServer() }
                        Button("Выйти", role: .destructive) { model.logout() }
                    } label: { Image(systemName: "person.circle") }
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if model.modes.calendarMode {
                    Button {
                        editor = EditorRoute(meeting: nil)
                    } label: {
                        Label("Запланировать", systemImage: "plus")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 18)
                            .padding(.vertical, 14)
                            .background(Theme.primary)
                            .foregroundColor(.white)
                            .clipShape(Capsule())
                            .shadow(radius: 4)
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 64)
                }
            }
        }
        .sheet(item: $editor) { route in
            MeetingSheet(initial: route.meeting)
        }
        .sheet(item: $inviteRoute) { route in
            InviteSheet(meeting: route.meeting)
        }
        .alert("Открыть по ссылке", isPresented: $showLinkPrompt) {
            TextField("https://…/room?meeting=… или /invite/…", text: $linkText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Открыть") {
                if let url = URL(string: linkText.trimmingCharacters(in: .whitespacesAndNewlines)) {
                    model.handleLink(url)
                }
                linkText = ""
            }
            Button("Отмена", role: .cancel) { linkText = "" }
        } message: {
            Text("Вставьте ссылку на встречу, комнату или приглашение.")
        }
    }

    private func openMeeting(_ key: String) {
        if let meeting = model.meetings.first(where: { $0.key == key }) {
            editor = EditorRoute(meeting: meeting)
        }
    }
}

// MARK: - Обзор

@MainActor
private struct OverviewView: View {
    @EnvironmentObject var model: AppModel
    let events: [CalEvent]
    let onOpen: (Meeting) -> Void
    let onInvite: (Meeting) -> Void
    let onOpenCalendar: () -> Void
    let onEventClick: (String) -> Void

    @State private var monthAnchor = startOfMonth(Date())
    @State private var uploadTarget: Meeting?
    @State private var showImporter = false
    @State private var previewURL: URL?

    private var upcoming: [Meeting] {
        upcomingDistinctSeries(
            model.meetings,
            now: Date(),
            limit: 6,
            idOf: { $0.id },
            endsAtOf: { parseInstant($0.ends_at) },
            isScheduled: { $0.status == "scheduled" }
        )
    }

    private var todayCount: Int {
        model.meetings.filter {
            $0.status == "scheduled" && isSameDay(parseInstant($0.starts_at), Date())
        }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                stats
                HStack {
                    Text("Ближайшие встречи").font(.headline)
                    Spacer()
                    Button("Открыть календарь", action: onOpenCalendar).font(.subheadline)
                }
                if upcoming.isEmpty {
                    Text("Запланированных встреч пока нет.").foregroundColor(Theme.muted)
                } else {
                    ForEach(upcoming, id: \.key) { meeting in
                        meetingCard(meeting)
                    }
                }
                monthCard
            }
            .padding(16)
            .padding(.bottom, 90)
        }
        .refreshable {
            model.loadMeetings()
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: attachmentContentTypes) { result in
            guard let meeting = uploadTarget, case .success(let url) = result else { return }
            uploadTarget = nil
            Task {
                do {
                    try await model.uploadAttachment(meetingId: meeting.id, file: url, existingCount: meeting.attachments.count)
                    model.loadMeetings()
                    model.showToast("Файл прикреплён")
                } catch {
                    model.showToast("Не удалось загрузить файл", errorText(error), isError: true)
                }
            }
        }
        .quickLookPreview($previewURL)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("РАБОЧЕЕ ПРОСТРАНСТВО")
                .font(.caption.weight(.semibold))
                .foregroundColor(Theme.primary)
            Text("Добрый день, \(model.user?.displayName ?? "")").font(.title2.weight(.semibold))
            if model.modes.freeMode {
                Button("Свободная комната") { model.openWaiting(JoinTarget()) }
                    .buttonStyle(.bordered)
                    .padding(.top, 6)
            }
            ErrorText(message: model.loadError)
        }
    }

    private var stats: some View {
        let isAdmin = model.user?.isAdmin == true
        return HStack(spacing: 8) {
            StatCard(label: "Ближайшие встречи", value: "\(upcoming.count)", hint: isAdmin ? "во всей организации" : "доступно вам")
            StatCard(label: "Сегодня", value: "\(todayCount)", hint: "встречи в календаре")
            StatCard(label: "Ваш доступ", value: isAdmin ? "Admin" : "User", hint: "роль в системе")
        }
    }

    private func meetingCard(_ meeting: Meeting) -> some View {
        let canManage = model.user?.isAdmin == true || meeting.organizer_id == model.user?.id
        let period = Recurrence.from(meeting.recurrence)
        let periodText = period == .none ? "" : " · \(period.label.lowercased())"
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack {
                    Text(formatDayMonth(meeting.starts_at)).font(.subheadline.weight(.bold))
                    Text(formatTime(meeting.starts_at)).font(.subheadline).foregroundColor(Theme.muted)
                }
                .frame(width: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text(meeting.displayTitle).font(.headline)
                    Text("\(meeting.organizer_name) · \(meeting.participants.count) участников\(periodText)")
                        .font(.footnote)
                        .foregroundColor(Theme.muted)
                    if !meeting.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        LinkedText(text: meeting.description.trimmingCharacters(in: .whitespacesAndNewlines))
                            .font(.subheadline)
                    }
                    ForEach(meeting.attachments, id: \.id) { attachment in
                        Button {
                            Task { previewURL = await model.downloadAttachment(attachment) }
                        } label: {
                            Label(attachment.original_name, systemImage: "paperclip").font(.footnote)
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                Button("Открыть") { onOpen(meeting) }.buttonStyle(.bordered)
                if canManage {
                    Button("Пригласить") { onInvite(meeting) }.buttonStyle(.bordered)
                    Button("Файл") {
                        uploadTarget = meeting
                        showImporter = true
                    }.buttonStyle(.bordered)
                }
                Spacer(minLength: 0)
                Button("Подключиться") {
                    model.openWaiting(JoinTarget(meetingId: meeting.id, title: meeting.title))
                }.buttonStyle(.borderedProminent)
            }
            .font(.footnote)
        }
        .cardStyle()
    }

    private var monthCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Календарь месяца").font(.headline)
                Spacer()
                Button("Развернуть", action: onOpenCalendar).font(.subheadline)
            }
            HStack {
                Button { monthAnchor = shiftAnchor(.month, monthAnchor, direction: -1) } label: { Image(systemName: "chevron.left") }
                Text(calendarTitle(.month, monthAnchor)).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
                Button { monthAnchor = shiftAnchor(.month, monthAnchor, direction: 1) } label: { Image(systemName: "chevron.right") }
            }
            MonthGridView(anchor: monthAnchor, events: events, compact: true, onDayClick: { _ in onOpenCalendar() }, onEventClick: onEventClick)
        }
        .cardStyle()
    }
}

private struct StatCard: View {
    let label: String
    let value: String
    let hint: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundColor(Theme.muted).lineLimit(2)
            Text(value).font(.title3.weight(.bold))
            Text(hint).font(.caption2).foregroundColor(Theme.muted).lineLimit(2)
        }
        .cardStyle(padding: 10)
    }
}

// MARK: - Календарь

struct CalendarView: View {
    let events: [CalEvent]
    let onEventClick: (String) -> Void

    @State private var mode = CalendarMode.month
    @State private var anchor = startOfMonth(Date())

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Picker("Режим", selection: $mode) {
                    ForEach(CalendarMode.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                .onChange(of: mode) { newMode in
                    // Для недели и дня начинаем с сегодняшнего дня, для месяца — с начала месяца.
                    anchor = newMode == .month ? startOfMonth(anchor) : startOfDay(Date())
                }

                HStack {
                    Button { anchor = shiftAnchor(mode, anchor, direction: -1) } label: { Image(systemName: "chevron.left") }
                    Text(calendarTitle(mode, anchor)).font(.headline).frame(maxWidth: .infinity)
                    Button { anchor = shiftAnchor(mode, anchor, direction: 1) } label: { Image(systemName: "chevron.right") }
                }
                Button("Сегодня") { anchor = mode == .month ? startOfMonth(Date()) : startOfDay(Date()) }
                    .buttonStyle(.bordered)

                switch mode {
                case .month:
                    MonthGridView(
                        anchor: anchor,
                        events: events,
                        compact: false,
                        onDayClick: { day in
                            mode = .day
                            anchor = day
                        },
                        onEventClick: onEventClick
                    )
                case .week:
                    AgendaView(days: weekDays(anchor), events: events, onEventClick: onEventClick)
                case .day:
                    AgendaView(days: [startOfDay(anchor)], events: events, onEventClick: onEventClick)
                }
            }
            .padding(16)
            .padding(.bottom, 90)
        }
    }
}

/// Список встреч по дням (для режимов «неделя» и «день»).
private struct AgendaView: View {
    let days: [Date]
    let events: [CalEvent]
    let onEventClick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(days, id: \.self) { day in
                let dayEvents = eventsOnDay(events, day)
                VStack(alignment: .leading, spacing: 6) {
                    Text(dayLabel(day))
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(isSameDay(day, Date()) ? Theme.primary : Theme.text)
                    if dayEvents.isEmpty {
                        Text("Нет встреч").font(.footnote).foregroundColor(Theme.muted)
                    } else {
                        ForEach(dayEvents, id: \.key) { event in
                            Button { onEventClick(event.key) } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(formatTime(event.start))–\(formatTime(event.end))")
                                        .font(.footnote.monospacedDigit())
                                        .foregroundColor(Theme.muted)
                                        .frame(width: 96, alignment: .leading)
                                    Text(event.title).font(.subheadline).multilineTextAlignment(.leading)
                                    Spacer(minLength: 0)
                                }
                                .cardStyle(padding: 10)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Сетка месяца (понедельник — первый день).
struct MonthGridView: View {
    let anchor: Date
    let events: [CalEvent]
    let compact: Bool
    let onDayClick: (Date) -> Void
    let onEventClick: (String) -> Void

    var body: some View {
        let weeks = monthGrid(anchor)
        let currentMonth = ruCalendar.component(.month, from: anchor)
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                ForEach(weekDays(anchor), id: \.self) { day in
                    Text(dayOfWeekShort(day))
                        .font(.caption2)
                        .foregroundColor(Theme.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(weeks, id: \.first) { week in
                HStack(spacing: 2) {
                    ForEach(week, id: \.self) { day in
                        dayCell(day, inMonth: ruCalendar.component(.month, from: day) == currentMonth)
                    }
                }
            }
        }
    }

    private func dayCell(_ day: Date, inMonth: Bool) -> some View {
        let dayEvents = eventsOnDay(events, day)
        let isToday = isSameDay(day, Date())
        return Button { onDayClick(day) } label: {
            VStack(spacing: 2) {
                Text("\(ruCalendar.component(.day, from: day))")
                    .font(.caption.weight(isToday ? .bold : .regular))
                    .foregroundColor(isToday ? .white : (inMonth ? Theme.text : Theme.muted.opacity(0.5)))
                    .frame(width: 22, height: 22)
                    .background(isToday ? Theme.primary : Color.clear)
                    .clipShape(Circle())
                if compact {
                    if !dayEvents.isEmpty {
                        Circle().fill(Theme.primary).frame(width: 5, height: 5)
                    }
                } else {
                    ForEach(dayEvents.prefix(2), id: \.key) { event in
                        Text(event.title)
                            .font(.system(size: 9))
                            .lineLimit(1)
                            .padding(.horizontal, 2)
                            .frame(maxWidth: .infinity)
                            .background(Theme.primary.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                    if dayEvents.count > 2 {
                        Text("+\(dayEvents.count - 2)").font(.system(size: 9)).foregroundColor(Theme.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
            .frame(height: compact ? 40 : 78)
            .background(inMonth ? Theme.surfaceHigh.opacity(0.5) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}
