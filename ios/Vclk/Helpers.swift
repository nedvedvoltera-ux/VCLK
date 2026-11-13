import Foundation

let ruLocale = Locale(identifier: "ru_RU")

let maxAttachmentBytes: Int64 = 20 * 1024 * 1024
let maxAttachments = 10
let uploadCooldown: TimeInterval = 3.2

private let attachmentTypeByExtension: [String: String] = [
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
]

/// MIME для загрузки вложения по расширению (сервер сверяет расширение и MIME); nil — тип не разрешён.
func attachmentMimeType(_ fileName: String) -> String? {
    guard let dot = fileName.lastIndex(of: ".") else { return nil }
    let ext = String(fileName[fileName.index(after: dot)...]).lowercased()
    return attachmentTypeByExtension[ext]
}

/// Допустимые значения периода повторения (совпадают с сервером).
enum Recurrence: String, CaseIterable {
    case none, daily, weekly, monthly

    var label: String {
        switch self {
        case .none: return "Не повторять"
        case .daily: return "Каждый день"
        case .weekly: return "Каждую неделю"
        case .monthly: return "Каждый месяц"
        }
    }

    static func from(_ value: String?) -> Recurrence {
        value.flatMap { Recurrence(rawValue: $0) } ?? .none
    }

    static let periods: [Recurrence] = [.daily, .weekly, .monthly]
}

func reminderLabel(_ minutes: Int?) -> String {
    guard let minutes, minutes > 0 else { return "Без напоминания" }
    return minutes == 60 ? "За 1 час" : "За \(minutes) мин."
}

struct ReminderOption: Identifiable {
    let minutes: Int
    let label: String
    var id: Int { minutes }
}

let reminderOptions: [ReminderOption] = [
    ReminderOption(minutes: 0, label: "Без напоминания"),
    ReminderOption(minutes: 15, label: "За 15 минут"),
    ReminderOption(minutes: 30, label: "За 30 минут"),
    ReminderOption(minutes: 60, label: "За 1 час"),
]

/// Приводит введённый адрес сервера к виду `https://host[:port]`, либо nil, если адрес некорректен.
func normalizeServerUrl(_ input: String) -> String? {
    var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty { return nil }
    if value.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) == nil {
        value = "https://" + value
    }
    guard let components = URLComponents(string: value),
          let scheme = components.scheme?.lowercased(),
          scheme == "https" || scheme == "http",
          let host = components.host, !host.isEmpty else { return nil }
    let port = components.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(port)"
}

/// Адрес сигналинга LiveKit через nginx-прокси: `wss://host/livekit`.
func buildSignalingUrl(_ serverUrl: String) -> String {
    guard let components = URLComponents(string: serverUrl), let host = components.host else { return serverUrl }
    let scheme = components.scheme?.lowercased() == "https" ? "wss" : "ws"
    let port = components.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(port)/livekit"
}

func buildInviteLink(_ serverUrl: String, room: String, defaultRoom: String = "demo-room") -> String {
    let trimmed = room.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = trimmed.isEmpty ? defaultRoom : trimmed
    let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? value
    return "\(serverUrl)/room?room=\(encoded)"
}

func buildMeetingLink(_ serverUrl: String, meetingId: String) -> String {
    "\(serverUrl)/room?meeting=\(meetingId)"
}

func canJoin(room: String, username: String) -> Bool {
    !room.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

func isNonEmptyChatMessage(_ value: String) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// Автозапись: включена опция встречи, в комнате 2 и более участников,
/// запись ещё не идёт и попытка раньше не делалась.
func shouldAutoStartRecording(
    recordingEnabled: Bool,
    participantCount: Int,
    alreadyRecording: Bool,
    alreadyAttempted: Bool
) -> Bool {
    recordingEnabled && participantCount >= 2 && !alreadyRecording && !alreadyAttempted
}

/// Демонстрация экрана стоит перед камерами (порядок внутри групп сохраняется).
func sortByScreenSharePriority<T>(_ items: [T], isScreenShare: (T) -> Bool) -> [T] {
    items.filter(isScreenShare) + items.filter { !isScreenShare($0) }
}

enum MobileLayoutMode { case single, two, stack }

func mobileLayoutMode(trackCount: Int) -> MobileLayoutMode {
    if trackCount <= 1 { return .single }
    if trackCount == 2 { return .two }
    return .stack
}

/// URL фото участника из metadata LiveKit (`{"avatarUrl":"/avatar/…"}`) с учётом адреса сервера.
func parseParticipantAvatarUrl(_ metadata: String?, serverUrl: String) -> String? {
    guard let metadata, !metadata.isEmpty,
          let regex = try? NSRegularExpression(pattern: "\"avatarUrl\"\\s*:\\s*\"([^\"]+)\""),
          let match = regex.firstMatch(in: metadata, range: NSRange(metadata.startIndex..., in: metadata)),
          let range = Range(match.range(at: 1), in: metadata) else { return nil }
    let raw = String(metadata[range]).replacingOccurrences(of: "\\/", with: "/")
    if raw.hasPrefix("http://") || raw.hasPrefix("https://") { return raw }
    if raw.hasPrefix("/") {
        var base = serverUrl
        while base.hasSuffix("/") { base.removeLast() }
        return base + raw
    }
    return nil
}

// MARK: - Даты

private let isoPlain = ISO8601DateFormatter()
private let isoFractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

func parseInstant(_ value: String) -> Date {
    isoPlain.date(from: value) ?? isoFractional.date(from: value) ?? Date()
}

func toIsoString(_ date: Date) -> String { isoPlain.string(from: date) }

private func makeFormatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = ruLocale
    formatter.dateFormat = format
    return formatter
}

private let timeFormatter = makeFormatter("HH:mm")
private let dayMonthFormatter = makeFormatter("d MMM")
private let dateTimeFormatter = makeFormatter("d MMM yyyy, HH:mm")

func formatTime(_ date: Date) -> String { timeFormatter.string(from: date) }
func formatTime(_ value: String) -> String { formatTime(parseInstant(value)) }
func formatDayMonth(_ value: String) -> String { dayMonthFormatter.string(from: parseInstant(value)) }
func formatDateTime(_ date: Date) -> String { dateTimeFormatter.string(from: date) }
func formatDateTime(_ value: String) -> String { formatDateTime(parseInstant(value)) }

/// При правке одного вхождения серии время всей серии сдвигается на ту же разницу:
/// base + (new - occurrence).
func shiftSeriesTime(seriesTime: Date, occurrenceTime: Date, newTime: Date) -> Date {
    seriesTime.addingTimeInterval(newTime.timeIntervalSince(occurrenceTime))
}

/// Следующий «час» от текущего момента: время по умолчанию для новой встречи.
func defaultMeetingStart(now: Date = Date()) -> Date {
    let calendar = Calendar.current
    let nextHour = calendar.date(byAdding: .hour, value: 1, to: now) ?? now
    var parts = calendar.dateComponents([.year, .month, .day, .hour], from: nextHour)
    parts.minute = 0
    parts.second = 0
    return calendar.date(from: parts) ?? nextHour
}

/// Ближайшие встречи: серия показывается один раз (ближайшее вхождение), ещё не закончившиеся.
func upcomingDistinctSeries<T>(
    _ items: [T],
    now: Date,
    limit: Int,
    idOf: (T) -> String,
    endsAtOf: (T) -> Date,
    isScheduled: (T) -> Bool
) -> [T] {
    var seen = Set<String>()
    var result: [T] = []
    for item in items {
        if endsAtOf(item) < now || !isScheduled(item) || !seen.insert(idOf(item)).inserted { continue }
        result.append(item)
        if result.count >= limit { break }
    }
    return result
}

func humanFileSize(_ bytes: Int64) -> String {
    String(format: "%.1f МБ", Double(bytes) / 1024.0 / 1024.0)
}

/// Имя попадает только в имя файла кеша — убираем недопустимые символы.
func safeFileName(_ name: String) -> String {
    let cleaned = name
        .replacingOccurrences(of: "[\\\\/:*?\"<>|\\u0000-\\u001f]", with: "_", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    return String((cleaned.isEmpty ? "attachment" : cleaned).prefix(120))
}

// MARK: - Ссылки в тексте

enum LinkKind { case text, url, email }

struct LinkToken: Equatable {
    let text: String
    let kind: LinkKind
    var href: String?
}

private let urlInTextPattern =
    "(https?://[^\\s<]+[^\\s<.,;:!?)]|www\\.[^\\s<]+[^\\s<.,;:!?)]|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})"

/// Делит текст на обычные фрагменты, ссылки (http/https/www) и e-mail — как `renderLinkedText` в вебе.
func tokenizeLinks(_ text: String) -> [LinkToken] {
    guard let regex = try? NSRegularExpression(pattern: urlInTextPattern) else {
        return [LinkToken(text: text, kind: .text)]
    }
    var tokens: [LinkToken] = []
    var cursor = text.startIndex
    for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        guard let range = Range(match.range, in: text) else { continue }
        if range.lowerBound > cursor {
            tokens.append(LinkToken(text: String(text[cursor..<range.lowerBound]), kind: .text))
        }
        let value = String(text[range])
        let lower = value.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            tokens.append(LinkToken(text: value, kind: .url, href: value))
        } else if lower.hasPrefix("www.") {
            tokens.append(LinkToken(text: value, kind: .url, href: "https://\(value)"))
        } else {
            tokens.append(LinkToken(text: value, kind: .email, href: "mailto:\(value)"))
        }
        cursor = range.upperBound
    }
    if cursor < text.endIndex {
        tokens.append(LinkToken(text: String(text[cursor...]), kind: .text))
    }
    return tokens
}
