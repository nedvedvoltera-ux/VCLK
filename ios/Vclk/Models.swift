import Foundation

extension KeyedDecodingContainer {
    /// Значение по ключу или значение по умолчанию (ключ отсутствует, null или другой тип).
    func get<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback
    }

    func opt<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
}

struct User: Decodable, Equatable {
    let id: String
    let email: String
    let displayName: String
    let role: String
    let authSource: String
    let active: Bool

    var isAdmin: Bool { role == "admin" }

    enum CodingKeys: String, CodingKey { case id, email, displayName, role, authSource, active }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        displayName = c.get(.displayName, "")
        role = c.get(.role, "user")
        authSource = c.get(.authSource, "local")
        active = c.get(.active, true)
    }
}

struct Recipient: Decodable, Equatable {
    let id: String
    let email: String
    let displayName: String

    enum CodingKeys: String, CodingKey { case id, email, displayName }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        displayName = c.get(.displayName, "")
    }
}

struct MeetingParticipant: Decodable, Equatable {
    let email: String
    let display_name: String?
    let invite_status: String
    let user_id: String?

    enum CodingKeys: String, CodingKey { case email, display_name, invite_status, user_id }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        email = try c.decode(String.self, forKey: .email)
        display_name = c.opt(.display_name)
        invite_status = c.get(.invite_status, "pending")
        user_id = c.opt(.user_id)
    }
}

struct Attachment: Decodable, Equatable {
    let id: String
    let original_name: String
    let content_type: String
    let size_bytes: Int64
    let created_at: String?

    enum CodingKeys: String, CodingKey { case id, original_name, content_type, size_bytes, created_at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        original_name = c.get(.original_name, "attachment")
        content_type = c.get(.content_type, "")
        size_bytes = c.get(.size_bytes, 0)
        created_at = c.opt(.created_at)
    }
}

struct Meeting: Decodable {
    let id: String
    let room_id: String
    let title: String
    let description: String
    let starts_at: String
    let ends_at: String
    let timezone: String
    let status: String
    let organizer_name: String
    let organizer_id: String
    let recording_enabled: Bool
    let reminder_minutes: Int?
    let recurrence: String
    let series_starts_at: String?
    let series_ends_at: String?
    let occurrence_key: String?
    let participants: [MeetingParticipant]
    let attachments: [Attachment]

    /// Каждое вхождение серии уникально, id встречи (комната) общий.
    var key: String { occurrence_key ?? id }
    var isRecurring: Bool { recurrence != "none" }
    /// Название со значком повтора, как в вебе.
    var displayTitle: String { isRecurring ? "\(title) ↻" : title }

    enum CodingKeys: String, CodingKey {
        case id, room_id, title, description, starts_at, ends_at, timezone, status
        case organizer_name, organizer_id, recording_enabled, reminder_minutes, recurrence
        case series_starts_at, series_ends_at, occurrence_key, participants, attachments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        room_id = c.get(.room_id, "")
        title = try c.decode(String.self, forKey: .title)
        description = c.get(.description, "")
        starts_at = try c.decode(String.self, forKey: .starts_at)
        ends_at = try c.decode(String.self, forKey: .ends_at)
        timezone = c.get(.timezone, "Europe/Moscow")
        status = c.get(.status, "scheduled")
        organizer_name = c.get(.organizer_name, "")
        organizer_id = c.get(.organizer_id, "")
        recording_enabled = c.get(.recording_enabled, false)
        reminder_minutes = c.opt(.reminder_minutes)
        recurrence = c.get(.recurrence, "none")
        series_starts_at = c.opt(.series_starts_at)
        series_ends_at = c.opt(.series_ends_at)
        occurrence_key = c.opt(.occurrence_key)
        participants = c.get(.participants, [])
        attachments = c.get(.attachments, [])
    }
}

struct Bootstrap: Decodable {
    var setupRequired = false
    var freeMode = false
    var calendarMode = true

    enum CodingKeys: String, CodingKey { case setupRequired, freeMode, calendarMode }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        setupRequired = c.get(.setupRequired, false)
        freeMode = c.get(.freeMode, false)
        calendarMode = c.get(.calendarMode, true)
    }
}

struct UserResponse: Decodable { let user: User }
struct MeetingsResponse: Decodable { let meetings: [Meeting]? }
struct MeetingResponse: Decodable { let meeting: Meeting }
struct RecipientsResponse: Decodable { let users: [Recipient]? }
struct InviteResponse: Decodable { let inviteUrl: String?; let warning: String? }

struct InviteInfo: Decodable {
    let email: String
    let meetingId: String?
    let title: String?
    let startsAt: String?
    let endsAt: String?
}

struct InviteInfoResponse: Decodable { let invite: InviteInfo }
struct ActivateResponse: Decodable { let user: User; let meetingId: String? }
struct JoinResponse: Decodable { let token: String; let roomName: String?; let meeting: Meeting? }
struct TokenResponse: Decodable { let token: String }
struct AvatarResponse: Decodable { let avatarUrl: String }
struct RecordingState: Decodable { let active: Bool?; let egressId: String? }
struct RecordingStatusResponse: Decodable { let recording: RecordingState? }
struct RecordingStartResponse: Decodable { let egressId: String? }
struct RecordingStopResponse: Decodable { let warning: String? }
struct ErrorResponse: Decodable { let error: String? }

/// Куда подключаемся: запланированная встреча или свободная комната по коду.
struct JoinTarget {
    var meetingId: String?
    var title: String?
    var roomCode: String = ""
}

/// Данные для входа в комнату общения.
struct RoomSession {
    let token: String
    let roomName: String
    let signalingUrl: String
    let autoRecord: Bool
    let micEnabled: Bool
    let cameraEnabled: Bool
    let frontCamera: Bool
    let inviteLink: String
}
