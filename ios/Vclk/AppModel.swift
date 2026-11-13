import Foundation
import SwiftUI

struct ToastMessage: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let detail: String?
    let isError: Bool
}

struct PickedFile: Identifiable {
    let id = UUID()
    let url: URL
    let name: String
    let size: Int64
}

@MainActor
final class AppModel: ObservableObject {
    let api = Api()

    @Published private(set) var serverUrl: String?
    @Published private(set) var checking = true
    @Published private(set) var user: User?
    @Published private(set) var modes = Bootstrap()
    @Published private(set) var meetings: [Meeting] = []
    @Published private(set) var recipients: [Recipient] = []
    @Published private(set) var loadError: String?
    @Published private(set) var inviteToken: String?
    @Published private(set) var joinTarget: JoinTarget?
    @Published private(set) var roomSession: RoomSession?
    @Published private(set) var roomTitle = ""
    @Published var toast: ToastMessage?

    /// Встреча/комната из ссылки, которую откроем после входа.
    private var pendingTarget: JoinTarget?
    private var lastUploadAt = Date.distantPast

    init() {
        serverUrl = api.serverUrl
        refreshSession()
    }

    func showToast(_ title: String, _ detail: String? = nil, isError: Bool = false) {
        toast = ToastMessage(title: title, detail: detail, isError: isError)
    }

    // MARK: - Сервер и сессия

    /// Возвращает текст ошибки, если адрес некорректен.
    func setServer(_ input: String) -> String? {
        guard let normalized = normalizeServerUrl(input) else {
            return "Введите адрес сервера, например https://vclk.company.ru"
        }
        api.setServerUrl(normalized)
        serverUrl = normalized
        user = nil
        meetings = []
        refreshSession()
        return nil
    }

    func changeServer() {
        Task { await api.logout() }
        api.setServerUrl(nil)
        serverUrl = nil
        user = nil
        meetings = []
        recipients = []
        joinTarget = nil
        roomSession = nil
    }

    func refreshSession() {
        guard api.serverUrl != nil else {
            checking = false
            return
        }
        checking = true
        Task {
            do {
                modes = try await api.bootstrap()
            } catch {
                loadError = errorText(error)
            }
            do {
                user = try await api.me()
                loadError = nil
                await onSignedIn()
            } catch let error as ApiError {
                user = nil
                if error.code != 401 && loadError == nil { loadError = error.message }
            } catch {
                user = nil
            }
            checking = false
        }
    }

    func refreshModes() {
        Task { if let value = try? await api.bootstrap() { modes = value } }
    }

    private func onSignedIn() async {
        await loadMeetingsInternal()
        if let list = try? await api.recipients() { recipients = list }
        if let target = pendingTarget {
            pendingTarget = nil
            joinTarget = target
        }
    }

    func login(email: String, password: String, ldap: Bool) async throws {
        user = try await api.login(email: email.trimmingCharacters(in: .whitespaces), password: password, ldap: ldap)
        loadError = nil
        await onSignedIn()
    }

    func setupAdmin(email: String, password: String, displayName: String) async throws {
        user = try await api.setup(
            email: email.trimmingCharacters(in: .whitespaces),
            password: password,
            displayName: displayName.trimmingCharacters(in: .whitespaces)
        )
        if let value = try? await api.bootstrap() { modes = value }
        await onSignedIn()
    }

    func logout() {
        Task {
            await api.logout()
            user = nil
            meetings = []
            recipients = []
            joinTarget = nil
            roomSession = nil
            refreshModes()
        }
    }

    // MARK: - Встречи

    func loadMeetings() {
        Task { await loadMeetingsInternal() }
    }

    private func loadMeetingsInternal() async {
        do {
            meetings = try await api.meetings()
            loadError = nil
        } catch let error as ApiError {
            if error.code == 401 { user = nil } else { loadError = error.message }
        } catch {
            loadError = errorText(error)
        }
    }

    func saveMeeting(id: String?, payload: MeetingPayload) async throws -> Meeting {
        let saved = try await api.saveMeeting(id: id, payload: payload)
        await loadMeetingsInternal()
        return saved
    }

    func deleteMeeting(id: String) async throws {
        try await api.deleteMeeting(id: id)
        await loadMeetingsInternal()
    }

    /// Создаёт приглашение; возвращает ссылку и предупреждение сервера.
    func invite(meetingId: String, email: String) async throws -> InviteResponse {
        try await api.createInvite(meetingId: meetingId, email: email.trimmingCharacters(in: .whitespaces))
    }

    /// Загрузка вложения с теми же ограничениями, что и в вебе.
    func uploadAttachment(meetingId: String, file: URL, existingCount: Int) async throws {
        let scoped = file.startAccessingSecurityScopedResource()
        defer { if scoped { file.stopAccessingSecurityScopedResource() } }
        let name = file.lastPathComponent
        let size = Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        if size > maxAttachmentBytes { throw ApiError("«\(name)» больше 20 МБ") }
        if existingCount >= maxAttachments {
            throw ApiError("К встрече можно прикрепить не более \(maxAttachments) файлов")
        }
        let wait = uploadCooldown - Date().timeIntervalSince(lastUploadAt)
        if wait > 0 { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
        try await api.uploadAttachment(meetingId: meetingId, fileURL: file, name: name)
        lastUploadAt = Date()
    }

    /// Скачивает вложение и возвращает локальный файл для просмотра.
    func downloadAttachment(_ attachment: Attachment) async -> URL? {
        do {
            return try await api.downloadAttachment(attachment)
        } catch {
            showToast("Не удалось открыть файл", errorText(error), isError: true)
            return nil
        }
    }

    // MARK: - Ссылки

    /// Обрабатывает ссылку `…/invite/<token>` или `…/room?meeting=…|room=…` (в том числе вставленную вручную).
    func handleLink(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host else { return }
        var origin = "\(scheme)://\(host)"
        if let port = url.port { origin += ":\(port)" }
        let path = url.path
        let isInvite = path.hasPrefix("/invite/")
        let isRoom = path == "/room"
        guard isInvite || isRoom else { return }

        if serverUrl != origin {
            api.setServerUrl(origin)
            serverUrl = origin
            user = nil
            meetings = []
        }
        if isInvite {
            let token = String(path.dropFirst("/invite/".count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            inviteToken = token.isEmpty ? nil : token
            refreshModes()
            checking = false
            return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let meetingId = items.first { $0.name == "meeting" }?.value
        let room = items.first { $0.name == "room" }?.value ?? ""
        let target = JoinTarget(meetingId: meetingId, title: nil, roomCode: room)
        if user != nil {
            openWaiting(target)
        } else {
            pendingTarget = target
            refreshSession()
        }
    }

    func finishInviteActivation(user activated: User, meetingId: String?) {
        inviteToken = nil
        user = activated
        Task {
            await onSignedIn()
            if let meetingId, !meetingId.isEmpty { joinTarget = JoinTarget(meetingId: meetingId) }
        }
    }

    func cancelInvite() {
        inviteToken = nil
    }

    // MARK: - Комната

    func openWaiting(_ target: JoinTarget) {
        joinTarget = target
    }

    func closeWaiting() {
        joinTarget = nil
    }

    /// Получает токен LiveKit для встречи или свободной комнаты. Бросает ApiError с понятным сообщением.
    func startJoin(
        target: JoinTarget,
        username: String,
        avatarJpeg: Data?,
        micEnabled: Bool,
        cameraEnabled: Bool,
        frontCamera: Bool
    ) async throws {
        guard let base = serverUrl else { throw ApiError("Не указан адрес сервера") }
        var avatarUrl: String?
        if let avatarJpeg {
            avatarUrl = try? await api.uploadAvatar(dataUrl: "data:image/jpeg;base64," + avatarJpeg.base64EncodedString())
        }
        let name = username.trimmingCharacters(in: .whitespaces)
        let session: RoomSession
        if let meetingId = target.meetingId {
            let response = try await api.join(meetingId: meetingId, username: name, avatarUrl: avatarUrl)
            roomTitle = response.meeting?.title ?? target.title ?? response.roomName ?? ""
            session = RoomSession(
                token: response.token,
                roomName: response.roomName ?? "",
                signalingUrl: buildSignalingUrl(base),
                autoRecord: response.meeting?.recording_enabled == true,
                micEnabled: micEnabled,
                cameraEnabled: cameraEnabled,
                frontCamera: frontCamera,
                inviteLink: buildMeetingLink(base, meetingId: meetingId)
            )
        } else {
            if !modes.freeMode {
                throw ApiError("Свободный режим отключён администратором. Войдите через запланированную встречу.")
            }
            let room = target.roomCode.trimmingCharacters(in: .whitespaces)
            let token = try await api.freeToken(room: room, username: name, avatarUrl: avatarUrl)
            roomTitle = room
            session = RoomSession(
                token: token,
                roomName: room,
                signalingUrl: buildSignalingUrl(base),
                autoRecord: false,
                micEnabled: micEnabled,
                cameraEnabled: cameraEnabled,
                frontCamera: frontCamera,
                inviteLink: buildInviteLink(base, room: room)
            )
        }
        roomSession = session
        joinTarget = nil
    }

    func leaveRoom() {
        roomSession = nil
        refreshModes()
        if user != nil { loadMeetings() }
    }
}
