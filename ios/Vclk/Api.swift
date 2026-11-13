import Foundation

struct ApiError: LocalizedError {
    let message: String
    var code: Int = 0

    init(_ message: String, code: Int = 0) {
        self.message = message
        self.code = code
    }

    var errorDescription: String? { message }
}

func errorText(_ error: Error) -> String {
    (error as? ApiError)?.message ?? error.localizedDescription
}

/// Клиент REST API сервера VCLK. Сессия — cookie `vclk_session`, хранится между запусками.
final class Api {
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let defaults = UserDefaults.standard
    private let serverKey = "vclk.server_url"
    private let cookiesKey = "vclk.cookies"

    private(set) var serverUrl: String?

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        serverUrl = defaults.string(forKey: serverKey)
        restoreCookies()
    }

    /// Смена сервера сбрасывает сессию.
    func setServerUrl(_ value: String?) {
        if value != serverUrl { clearCookies() }
        serverUrl = value
        if let value {
            defaults.set(value, forKey: serverKey)
        } else {
            defaults.removeObject(forKey: serverKey)
        }
        restoreCookies()
    }

    // MARK: - Cookies

    private var baseUrl: URL? { serverUrl.flatMap(URL.init(string:)) }

    private func saveCookies() {
        guard let url = baseUrl else { return }
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        let stored: [[String: Any]] = cookies.compactMap { cookie in
            guard let properties = cookie.properties else { return nil }
            var plain: [String: Any] = [:]
            for (key, value) in properties {
                // В UserDefaults можно класть только plist-типы (например, URL нельзя).
                if value is String || value is Date || value is NSNumber { plain[key.rawValue] = value }
            }
            return plain
        }
        defaults.set(stored, forKey: cookiesKey)
    }

    private func restoreCookies() {
        guard baseUrl != nil,
              let stored = defaults.array(forKey: cookiesKey) as? [[String: Any]] else { return }
        for plain in stored {
            var properties: [HTTPCookiePropertyKey: Any] = [:]
            for (key, value) in plain { properties[HTTPCookiePropertyKey(key)] = value }
            if let cookie = HTTPCookie(properties: properties) {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }
    }

    private func clearCookies() {
        if let url = baseUrl {
            for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        defaults.removeObject(forKey: cookiesKey)
    }

    // MARK: - Запросы

    private func makeRequest(_ method: String, _ path: String, body: [String: Any]?) throws -> URLRequest {
        guard let base = serverUrl, let url = URL(string: base + path) else {
            throw ApiError("Не указан адрес сервера")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if method != "GET" && method != "DELETE" {
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ApiError("Нет связи с сервером: \(error.localizedDescription)")
        }
        saveCookies()
        guard let http = response as? HTTPURLResponse else { throw ApiError("Некорректный ответ сервера") }
        if !(200..<300).contains(http.statusCode) {
            let message = (try? decoder.decode(ErrorResponse.self, from: data))?.error
            throw ApiError(message ?? "Ошибка запроса (\(http.statusCode))", code: http.statusCode)
        }
        return data
    }

    @discardableResult
    private func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        try await perform(makeRequest(method, path, body: body))
    }

    private func call<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> T {
        let data = try await send(method, path, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw ApiError("Некорректный ответ сервера")
        }
    }

    private func encoded(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? value
    }

    // MARK: - Сессия

    func bootstrap() async throws -> Bootstrap { try await call("GET", "/api/bootstrap") }

    func me() async throws -> User {
        let response: UserResponse = try await call("GET", "/api/auth/me")
        return response.user
    }

    func login(email: String, password: String, ldap: Bool) async throws -> User {
        let response: UserResponse = try await call("POST", "/api/auth/login", body: [
            "email": email, "password": password, "source": ldap ? "ldap" : "local",
        ])
        return response.user
    }

    func setup(email: String, password: String, displayName: String) async throws -> User {
        let response: UserResponse = try await call("POST", "/api/setup", body: [
            "email": email, "password": password, "displayName": displayName,
        ])
        return response.user
    }

    func logout() async {
        _ = try? await send("POST", "/api/auth/logout")
        clearCookies()
    }

    // MARK: - Встречи

    func meetings() async throws -> [Meeting] {
        let response: MeetingsResponse = try await call("GET", "/api/meetings?from=2020-01-01&to=2100-01-01")
        return response.meetings ?? []
    }

    func meeting(id: String) async throws -> Meeting {
        let response: MeetingResponse = try await call("GET", "/api/meetings/\(id)")
        return response.meeting
    }

    func recipients() async throws -> [Recipient] {
        let response: RecipientsResponse = try await call("GET", "/api/users/recipients")
        return response.users ?? []
    }

    func saveMeeting(id: String?, payload: MeetingPayload) async throws -> Meeting {
        let response: MeetingResponse = try await call(
            id == nil ? "POST" : "PATCH",
            id == nil ? "/api/meetings" : "/api/meetings/\(id!)",
            body: payload.json
        )
        return response.meeting
    }

    func deleteMeeting(id: String) async throws {
        try await send("DELETE", "/api/meetings/\(id)")
    }

    func createInvite(meetingId: String, email: String) async throws -> InviteResponse {
        try await call("POST", "/api/meetings/\(meetingId)/invites", body: ["email": email])
    }

    func inviteInfo(token: String) async throws -> InviteInfo {
        let response: InviteInfoResponse = try await call("GET", "/api/invites/\(encoded(token))")
        return response.invite
    }

    func activateInvite(token: String, displayName: String, password: String) async throws -> ActivateResponse {
        try await call("POST", "/api/invites/\(encoded(token))/activate", body: [
            "displayName": displayName, "password": password,
        ])
    }

    // MARK: - Вложения

    func uploadAttachment(meetingId: String, fileURL: URL, name: String) async throws {
        guard let mime = attachmentMimeType(name) else {
            throw ApiError("Допустимы только PDF, Office-документы, TXT, CSV, PNG и JPEG")
        }
        let fileData: Data
        do {
            fileData = try Data(contentsOf: fileURL)
        } catch {
            throw ApiError("Не удалось прочитать файл «\(name)»")
        }
        let boundary = "vclk-\(UUID().uuidString)"
        var body = Data()
        func add(_ text: String) { body.append(Data(text.utf8)) }
        let safeName = name.replacingOccurrences(of: "\"", with: "_")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        add("Content-Type: \(mime)\r\n\r\n")
        body.append(fileData)
        add("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"humanConfirmed\"\r\n\r\ntrue\r\n")
        add("--\(boundary)--\r\n")

        var request = try makeRequest("POST", "/api/meetings/\(meetingId)/attachments", body: nil)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        _ = try await perform(request)
    }

    /// Скачивает вложение во временную папку и возвращает файл (для просмотра через Quick Look).
    func downloadAttachment(_ attachment: Attachment) async throws -> URL {
        let data = try await send("GET", "/api/attachments/\(attachment.id)")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let target = directory.appendingPathComponent("\(attachment.id)-\(safeFileName(attachment.original_name))")
        try data.write(to: target, options: .atomic)
        return target
    }

    // MARK: - Комната

    func join(meetingId: String, username: String, avatarUrl: String?) async throws -> JoinResponse {
        try await call("POST", "/api/meetings/\(meetingId)/join", body: [
            "username": username, "avatarUrl": avatarUrl ?? "",
        ])
    }

    func freeToken(room: String, username: String, avatarUrl: String?) async throws -> String {
        let response: TokenResponse = try await call("POST", "/token", body: [
            "room": room, "username": username, "avatarUrl": avatarUrl ?? "",
        ])
        return response.token
    }

    func uploadAvatar(dataUrl: String) async throws -> String {
        let response: AvatarResponse = try await call("POST", "/avatar", body: ["imageDataUrl": dataUrl])
        return response.avatarUrl
    }

    func recordingStatus(room: String) async throws -> (active: Bool, egressId: String?) {
        let response: RecordingStatusResponse = try await call("GET", "/recording/status?room=\(encoded(room))")
        return (response.recording?.active ?? false, response.recording?.egressId)
    }

    func startRecording(room: String) async throws -> String? {
        let response: RecordingStartResponse = try await call("POST", "/recording/start", body: ["room": room])
        return response.egressId
    }

    func stopRecording(room: String, egressId: String?) async throws -> String? {
        var body: [String: Any] = ["room": room]
        if let egressId { body["egressId"] = egressId }
        let response: RecordingStopResponse = try await call("POST", "/recording/stop", body: body)
        return response.warning
    }
}

/// Данные формы встречи в формате API.
struct MeetingPayload {
    let title: String
    let description: String
    let startsAt: String
    let endsAt: String
    let timezone: String
    let recordingEnabled: Bool
    let reminderMinutes: Int
    let recurrence: String
    let participantEmails: [String]

    var json: [String: Any] {
        [
            "title": title,
            "description": description,
            "startsAt": startsAt,
            "endsAt": endsAt,
            "timezone": timezone,
            "recordingEnabled": recordingEnabled,
            "reminderMinutes": reminderMinutes,
            "recurrence": recurrence,
            "participants": participantEmails.map { ["email": $0] },
        ]
    }
}

extension CharacterSet {
    /// Допустимые символы значения query-параметра (без & = + и т. п.).
    static let urlQueryValueAllowed: CharacterSet = {
        CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    }()
}
