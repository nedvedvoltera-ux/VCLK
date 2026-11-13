import LiveKit
import SwiftUI
import UIKit

struct ChatMessage: Identifiable {
    let id = UUID()
    let author: String
    let text: String
    let date: Date
}

/// Плитка в комнате: камера участника или его демонстрация экрана.
struct TileRef: Identifiable {
    let id: String
    let participant: Participant
    let source: Track.Source
    let publication: TrackPublication?

    var isScreenShare: Bool { source == .screenShareVideo }
}

/// Слушатель событий комнаты (протокол LiveKit основан на Objective-C, поэтому отдельный NSObject).
final class RoomEvents: NSObject, RoomDelegate {
    var onDisconnect: (() -> Void)?

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async { [weak self] in self?.onDisconnect?() }
    }
}

/// Подключение к LiveKit, чат, запись и автозапись.
@MainActor
final class RoomController: ObservableObject {
    let room: Room
    let session: RoomSession
    private let model: AppModel
    private let events = RoomEvents()

    @Published private(set) var connected = false
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var recording = false
    @Published private(set) var recordingBusy = false

    private var egressId: String?
    private var autoAttempted = false
    private var finished = false
    private var loopTask: Task<Void, Never>?

    init(session: RoomSession, model: AppModel) {
        self.session = session
        self.model = model
        room = Room(
            roomOptions: RoomOptions(
                defaultCameraCaptureOptions: CameraCaptureOptions(position: session.frontCamera ? .front : .back),
                adaptiveStream: true,
                dynacast: true
            )
        )
    }

    func start() async {
        events.onDisconnect = { [weak self] in self?.onDisconnected() }
        room.delegates.add(delegate: events)
        do {
            try await room.connect(url: session.signalingUrl, token: session.token)
        } catch {
            finished = true
            model.showToast("Не удалось подключиться к комнате", errorText(error), isError: true)
            model.leaveRoom()
            return
        }
        connected = true
        let local = room.localParticipant
        if session.micEnabled { _ = try? await local.setMicrophone(enabled: true) }
        if session.cameraEnabled { _ = try? await local.setCamera(enabled: true) }
        await registerChat()
        startLoop()
    }

    // MARK: - Завершение

    func leave() async {
        guard !finished else { return }
        finished = true
        loopTask?.cancel()
        await room.disconnect()
        model.leaveRoom()
    }

    /// Вызывается при уходе с экрана комнаты (в том числе при выходе по кнопке).
    func teardown() {
        loopTask?.cancel()
        if !finished {
            finished = true
            Task { await room.disconnect() }
        }
    }

    private func onDisconnected() {
        guard !finished else { return }
        finished = true
        loopTask?.cancel()
        model.showToast("Соединение завершено")
        model.leaveRoom()
    }

    // MARK: - Чат

    private func registerChat() async {
        _ = try? await room.registerTextStreamHandler(for: "lk.chat") { [weak self] reader, identity in
            let text = try await reader.readAll()
            await self?.receive(text: text, from: identity)
        }
    }

    private func receive(text: String, from identity: Participant.Identity) {
        let name = room.remoteParticipants[identity]?.name ?? identity.stringValue
        messages.append(ChatMessage(author: name, text: text, date: Date()))
    }

    func sendChat(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await room.localParticipant.sendText(trimmed, for: "lk.chat")
            messages.append(ChatMessage(author: "Вы", text: trimmed, date: Date()))
        } catch {
            model.showToast("Сообщение не отправлено", errorText(error), isError: true)
        }
    }

    // MARK: - Запись

    private func startLoop() {
        guard model.user != nil else { return } // гостям запись недоступна
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func tick() async {
        if let status = try? await model.api.recordingStatus(room: session.roomName) {
            recording = status.active
            egressId = status.egressId
        }
        let count = room.remoteParticipants.count + 1
        if shouldAutoStartRecording(
            recordingEnabled: session.autoRecord,
            participantCount: count,
            alreadyRecording: recording,
            alreadyAttempted: autoAttempted
        ) {
            autoAttempted = true
            do {
                try await startRecording()
                model.showToast("Запись началась", "Автозапись включена: в комнате два участника.")
            } catch {
                model.showToast("Не удалось начать запись", errorText(error), isError: true)
            }
        }
    }

    private func startRecording() async throws {
        recordingBusy = true
        defer { recordingBusy = false }
        egressId = try await model.api.startRecording(room: session.roomName)
        recording = true
    }

    func toggleRecording() async {
        do {
            if recording {
                recordingBusy = true
                defer { recordingBusy = false }
                let warning = try await model.api.stopRecording(room: session.roomName, egressId: egressId)
                recording = false
                egressId = nil
                model.showToast("Запись остановлена", warning)
            } else {
                try await startRecording()
                model.showToast("Запись началась")
            }
        } catch {
            model.showToast("Ошибка записи", errorText(error), isError: true)
        }
    }

    // MARK: - Камера

    func flipCamera() async {
        guard let track = room.localParticipant.firstCameraPublication?.track as? LocalVideoTrack,
              let capturer = track.capturer as? CameraCapturer else { return }
        _ = try? await capturer.switchCameraPosition()
    }
}

@MainActor
struct RoomView: View {
    @EnvironmentObject var model: AppModel
    @StateObject private var controller: RoomController

    init(session: RoomSession, model: AppModel) {
        _controller = StateObject(wrappedValue: RoomController(session: session, model: model))
    }

    var body: some View {
        RoomStage(controller: controller, room: controller.room)
            .task { await controller.start() }
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear {
                UIApplication.shared.isIdleTimerDisabled = false
                controller.teardown()
            }
    }
}

@MainActor
private struct RoomStage: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var controller: RoomController
    @ObservedObject var room: Room

    @State private var gridMode = false
    @State private var selectedId: String?
    @State private var showParticipants = false
    @State private var showChat = false
    @State private var confirmLeave = false
    @State private var seenMessages = 0

    private var participants: [Participant] {
        var all: [Participant] = [room.localParticipant]
        let remotes = room.remoteParticipants.values.sorted {
            ($0.identity?.stringValue ?? "") < ($1.identity?.stringValue ?? "")
        }
        all.append(contentsOf: remotes)
        return all
    }

    private var tiles: [TileRef] {
        var result: [TileRef] = []
        for participant in participants {
            let identity = participant.identity?.stringValue ?? "unknown"
            let publications = participant.trackPublications.values
            let camera = publications.first { $0.source == .camera }
            result.append(TileRef(id: "\(identity):camera", participant: participant, source: .camera, publication: camera))
            if let screen = publications.first(where: { $0.source == .screenShareVideo }) {
                result.append(TileRef(id: "\(identity):screen", participant: participant, source: .screenShareVideo, publication: screen))
            }
        }
        return sortByScreenSharePriority(result) { $0.isScreenShare }
    }

    var body: some View {
        let allTiles = tiles
        let main = allTiles.first { $0.id == selectedId }
            ?? allTiles.first { $0.isScreenShare }
            ?? allTiles.first { !($0.participant is LocalParticipant) }
            ?? allTiles.first
        let unread = max(controller.messages.count - seenMessages, 0)

        VStack(spacing: 0) {
            topBar

            ZStack(alignment: .topTrailing) {
                if !controller.connected {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if allTiles.isEmpty {
                    Text("Ожидание участников…").foregroundColor(Theme.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if gridMode {
                    GridStage(tiles: allTiles, serverUrl: model.serverUrl ?? "") { tile in
                        selectedId = tile.id
                        gridMode = false
                    }
                } else if let main {
                    FocusStage(tiles: allTiles, main: main, serverUrl: model.serverUrl ?? "") { tile in
                        selectedId = tile.id
                    }
                }
                if showParticipants {
                    ParticipantsPanel(participants: participants) { showParticipants = false }
                        .padding(4)
                }
            }
            .padding(.horizontal, 8)

            ControlsBar(
                local: room.localParticipant,
                controller: controller,
                gridMode: $gridMode,
                unread: unread,
                onChat: { showChat = true },
                onLeave: { confirmLeave = true },
                signedIn: model.user != nil
            )
        }
        .background(Color.black.ignoresSafeArea())
        .sheet(isPresented: $showChat) {
            ChatSheet(controller: controller)
                .presentationDetents([.large])
                .onAppear { seenMessages = controller.messages.count }
                .onChange(of: controller.messages.count) { count in seenMessages = count }
        }
        .confirmationDialog("Выйти из встречи?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await controller.leave() } }
            Button("Остаться", role: .cancel) {}
        } message: {
            Text("Вы покинете комнату. Остальные участники останутся в ней.")
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            TimelineView(.periodic(from: .now, by: 15)) { context in
                Text(formatTime(context.date))
                    .font(.subheadline.monospacedDigit())
                    .foregroundColor(Theme.muted)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(model.roomTitle.isEmpty ? controller.session.roomName : model.roomTitle)
                    .font(.headline)
                    .lineLimit(1)
                Text(controller.connected ? "Участников: \(room.remoteParticipants.count + 1)" : "Подключение…")
                    .font(.caption)
                    .foregroundColor(Theme.muted)
            }
            Spacer()
            if controller.recording {
                HStack(spacing: 4) {
                    Circle().fill(Color.white).frame(width: 7, height: 7)
                    Text("REC").font(.caption.weight(.bold))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Theme.rec)
                .clipShape(Capsule())
            }
            Button { showParticipants.toggle() } label: { Image(systemName: "person.2") }
            if !controller.session.inviteLink.isEmpty {
                Button {
                    UIPasteboard.general.string = controller.session.inviteLink
                    model.showToast("Ссылка скопирована", controller.session.inviteLink)
                } label: { Image(systemName: "doc.on.doc") }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Сцены

/// Режим «фокус»: одна основная плитка и остальные в превью (по числу плиток — одиночный / два / стопка).
@MainActor
private struct FocusStage: View {
    let tiles: [TileRef]
    let main: TileRef
    let serverUrl: String
    let onSelect: (TileRef) -> Void

    var body: some View {
        let others = tiles.filter { $0.id != main.id }
        switch mobileLayoutMode(trackCount: tiles.count) {
        case .single:
            TileView(participant: main.participant, tile: main, serverUrl: serverUrl)
        case .two:
            ZStack(alignment: .topTrailing) {
                TileView(participant: main.participant, tile: main, serverUrl: serverUrl)
                if let other = others.first {
                    TileView(participant: other.participant, tile: other, serverUrl: serverUrl, compact: true)
                        .frame(width: 104, height: 148)
                        .padding(8)
                        .onTapGesture { onSelect(other) }
                }
            }
        case .stack:
            VStack(spacing: 6) {
                TileView(participant: main.participant, tile: main, serverUrl: serverUrl)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(others) { other in
                            TileView(participant: other.participant, tile: other, serverUrl: serverUrl, compact: true)
                                .frame(width: 80, height: 104)
                                .onTapGesture { onSelect(other) }
                        }
                    }
                }
                .frame(height: 104)
            }
        }
    }
}

/// Режим «сетка»: все плитки в два столбца.
@MainActor
private struct GridStage: View {
    let tiles: [TileRef]
    let serverUrl: String
    let onPick: (TileRef) -> Void

    var body: some View {
        let rows = stride(from: 0, to: tiles.count, by: 2).map { Array(tiles[$0..<min($0 + 2, tiles.count)]) }
        VStack(spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 6) {
                    ForEach(row) { tile in
                        TileView(participant: tile.participant, tile: tile, serverUrl: serverUrl, compact: tiles.count > 4)
                            .onTapGesture { onPick(tile) }
                    }
                    if row.count == 1 { Color.clear }
                }
            }
        }
    }
}

@MainActor
private struct TileView: View {
    @ObservedObject var participant: Participant
    let tile: TileRef
    let serverUrl: String
    var compact = false

    private var isLocal: Bool { participant is LocalParticipant }

    private var displayName: String {
        let base = participant.name?.isEmpty == false ? (participant.name ?? "") : (participant.identity?.stringValue ?? "Участник")
        let suffix = tile.isScreenShare ? " — экран" : ""
        return base + suffix + (isLocal ? " (вы)" : "")
    }

    private var videoTrack: VideoTrack? {
        guard let publication = tile.publication, publication.isSubscribed, !publication.isMuted else { return nil }
        return publication.track as? VideoTrack
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Theme.surface
            if let track = videoTrack {
                SwiftUIVideoView(track, layoutMode: tile.isScreenShare ? .fit : .fill, mirrorMode: .auto)
            } else {
                avatar
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Text(displayName)
                .font(.system(size: compact ? 10 : 12))
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .padding(6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(participant.isSpeaking ? Theme.success : Theme.outline, lineWidth: participant.isSpeaking ? 2 : 1)
        )
    }

    @ViewBuilder
    private var avatar: some View {
        let size: CGFloat = compact ? 44 : 96
        if let urlString = parseParticipantAvatarUrl(participant.metadata, serverUrl: serverUrl), let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
                default:
                    initials(size)
                }
            }
        } else {
            initials(size)
        }
    }

    private func initials(_ size: CGFloat) -> some View {
        let name = participant.name?.isEmpty == false ? (participant.name ?? "") : (participant.identity?.stringValue ?? "?")
        return Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.system(size: size * 0.4, weight: .semibold))
            .frame(width: size, height: size)
            .background(Theme.surfaceHigh)
            .clipShape(Circle())
    }
}

// MARK: - Панели

@MainActor
private struct ParticipantsPanel: View {
    let participants: [Participant]
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Участники (\(participants.count))").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Закрыть", action: onClose).font(.footnote)
            }
            ForEach(participants, id: \.identity?.stringValue) { participant in
                ParticipantRow(participant: participant)
            }
        }
        .padding(12)
        .frame(width: 250)
        .background(Theme.surfaceHigh)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.outline, lineWidth: 1))
    }
}

@MainActor
private struct ParticipantRow: View {
    @ObservedObject var participant: Participant

    var body: some View {
        HStack {
            Text((participant.name?.isEmpty == false ? (participant.name ?? "") : (participant.identity?.stringValue ?? "Участник"))
                + (participant is LocalParticipant ? " (вы)" : ""))
                .lineLimit(1)
            Spacer()
            Text(participant.isSpeaking ? "говорит" : "в сети")
                .font(.caption)
                .foregroundColor(participant.isSpeaking ? Theme.success : Theme.muted)
        }
        .font(.subheadline)
    }
}

@MainActor
private struct ChatSheet: View {
    @ObservedObject var controller: RoomController
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if controller.messages.isEmpty {
                                Text("Сообщений пока нет").foregroundColor(Theme.muted)
                            }
                            ForEach(controller.messages) { message in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text(message.author).font(.footnote.weight(.semibold))
                                        Text(formatTime(message.date)).font(.caption).foregroundColor(Theme.muted)
                                    }
                                    LinkedText(text: message.text)
                                }
                                .id(message.id)
                            }
                        }
                        .padding(16)
                    }
                    .onChange(of: controller.messages.count) { _ in
                        if let last = controller.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                Divider()
                HStack(spacing: 8) {
                    TextField("Введите сообщение", text: $draft, axis: .vertical)
                        .lineLimit(1...3)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        let text = draft
                        draft = ""
                        Task { await controller.sendChat(text) }
                    } label: {
                        Image(systemName: "paperplane.fill")
                    }
                    .disabled(!isNonEmptyChatMessage(draft))
                }
                .padding(12)
            }
            .navigationTitle("Сообщения")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) { Button("Закрыть") { dismiss() } }
            }
        }
    }
}

// MARK: - Управление

@MainActor
private struct ControlsBar: View {
    @ObservedObject var local: LocalParticipant
    @ObservedObject var controller: RoomController
    @Binding var gridMode: Bool
    let unread: Int
    let onChat: () -> Void
    let onLeave: () -> Void
    let signedIn: Bool

    var body: some View {
        HStack(spacing: 12) {
            RoundButton(systemName: local.isMicrophoneEnabled() ? "mic.fill" : "mic.slash.fill", active: local.isMicrophoneEnabled()) {
                Task { _ = try? await local.setMicrophone(enabled: !local.isMicrophoneEnabled()) }
            }
            RoundButton(systemName: local.isCameraEnabled() ? "video.fill" : "video.slash.fill", active: local.isCameraEnabled()) {
                Task { _ = try? await local.setCamera(enabled: !local.isCameraEnabled()) }
            }
            if local.isCameraEnabled() {
                RoundButton(systemName: "arrow.triangle.2.circlepath.camera", active: false) {
                    Task { await controller.flipCamera() }
                }
            }
            RoundButton(systemName: "bubble.left.fill", active: false, badge: unread, action: onChat)
            Menu {
                Button(gridMode ? "Вид: фокус" : "Вид: сетка") { gridMode.toggle() }
                if signedIn {
                    Button(controller.recording ? "Остановить запись" : "Начать запись") {
                        Task { await controller.toggleRecording() }
                    }
                    .disabled(controller.recordingBusy)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.title3)
                    .frame(width: 48, height: 48)
                    .background(Theme.surfaceHigh)
                    .foregroundColor(.white)
                    .clipShape(Circle())
            }
            RoundButton(systemName: "phone.down.fill", active: false, danger: true, action: onLeave)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
    }
}

private struct RoundButton: View {
    let systemName: String
    var active = false
    var danger = false
    var badge = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: systemName)
                    .font(.title3)
                    .frame(width: 48, height: 48)
                    .background(danger ? Theme.danger : (active ? Theme.primary : Theme.surfaceHigh))
                    .foregroundColor(.white)
                    .clipShape(Circle())
                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .padding(4)
                        .background(Theme.danger)
                        .clipShape(Circle())
                        .offset(x: 4, y: -4)
                }
            }
        }
    }
}
