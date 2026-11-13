package ru.asntl.vclk.data

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val email: String,
    val displayName: String,
    val role: String = "user",
    val authSource: String = "local",
    val active: Boolean = true,
) {
    val isAdmin: Boolean get() = role == "admin"
}

@Serializable
data class Recipient(val id: String, val email: String, val displayName: String)

@Serializable
data class MeetingParticipant(
    val email: String,
    val display_name: String? = null,
    val invite_status: String = "pending",
    val user_id: String? = null,
)

@Serializable
data class Attachment(
    val id: String,
    val original_name: String,
    val content_type: String = "",
    val size_bytes: Long = 0,
    val created_at: String? = null,
)

@Serializable
data class Meeting(
    val id: String,
    val room_id: String = "",
    val title: String,
    val description: String = "",
    val starts_at: String,
    val ends_at: String,
    val timezone: String = "Europe/Moscow",
    val status: String = "scheduled",
    val organizer_name: String = "",
    val organizer_id: String = "",
    val recording_enabled: Boolean = false,
    val reminder_minutes: Int? = null,
    val recurrence: String = "none",
    val series_starts_at: String? = null,
    val series_ends_at: String? = null,
    val occurrence_key: String? = null,
    val participants: List<MeetingParticipant> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
) {
    /** Каждое вхождение серии уникально, id встречи (комната) общий. */
    val key: String get() = occurrence_key ?: id
    val isRecurring: Boolean get() = recurrence != "none"
}

@Serializable
data class Bootstrap(
    val setupRequired: Boolean = false,
    val freeMode: Boolean = false,
    val calendarMode: Boolean = true,
)

@Serializable
data class UserResponse(val user: User)

@Serializable
data class MeetingsResponse(val meetings: List<Meeting> = emptyList())

@Serializable
data class MeetingResponse(val meeting: Meeting)

@Serializable
data class RecipientsResponse(val users: List<Recipient> = emptyList())

@Serializable
data class InviteResponse(val inviteUrl: String, val warning: String? = null)

@Serializable
data class InviteInfo(
    val email: String,
    val meetingId: String = "",
    val title: String = "",
    val startsAt: String = "",
    val endsAt: String = "",
)

@Serializable
data class InviteInfoResponse(val invite: InviteInfo)

@Serializable
data class ActivateResponse(val user: User, val meetingId: String = "")

@Serializable
data class JoinResponse(
    val token: String,
    val roomName: String = "",
    val meeting: Meeting? = null,
)

@Serializable
data class TokenResponse(val token: String)

@Serializable
data class AvatarResponse(val avatarUrl: String)

@Serializable
data class RecordingState(
    val active: Boolean = false,
    val egressId: String? = null,
)

@Serializable
data class RecordingStatusResponse(val recording: RecordingState = RecordingState())

@Serializable
data class RecordingStartResponse(val egressId: String? = null)

@Serializable
data class RecordingStopResponse(val warning: String? = null)

@Serializable
data class ErrorResponse(val error: String? = null)

/** Куда подключаемся: запланированная встреча или свободная комната по коду. */
data class JoinTarget(
    val meetingId: String? = null,
    val title: String? = null,
    val roomCode: String = "",
)

/** Данные для входа в комнату общения. */
data class RoomSession(
    val token: String,
    val roomName: String,
    val signalingUrl: String,
    val autoRecord: Boolean,
    val micEnabled: Boolean,
    val cameraEnabled: Boolean,
    val frontCamera: Boolean,
    val inviteLink: String = "",
)
