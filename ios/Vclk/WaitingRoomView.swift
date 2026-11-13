import AVFoundation
import LiveKit
import Network
import PhotosUI
import SwiftUI
import UIKit

/// Фото профиля как в вебе: квадрат по центру, 192×192, JPEG с качеством 82.
func makeAvatarJpeg(_ image: UIImage, size: CGFloat = 192) -> Data? {
    let side = min(image.size.width, image.size.height)
    guard side > 0 else { return nil }
    let originX = (image.size.width - side) / 2
    let originY = (image.size.height - side) / 2
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format)
    let scaled = renderer.image { _ in
        let scale = size / side
        image.draw(in: CGRect(
            x: -originX * scale,
            y: -originY * scale,
            width: image.size.width * scale,
            height: image.size.height * scale
        ))
    }
    return scaled.jpegData(compressionQuality: 0.82)
}

/// Тип сети для диагностики в комнате ожидания.
final class NetworkInfo: ObservableObject {
    @Published var text = "Проверка сети…"
    @Published var ok = false
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let text: String
            if path.status != .satisfied {
                text = "нет подключения"
            } else if path.usesInterfaceType(.wifi) {
                text = "Wi‑Fi"
            } else if path.usesInterfaceType(.cellular) {
                text = "мобильная сеть"
            } else if path.usesInterfaceType(.wiredEthernet) {
                text = "кабель"
            } else {
                text = "подключено"
            }
            DispatchQueue.main.async {
                self?.text = text
                self?.ok = path.status == .satisfied
            }
        }
        monitor.start(queue: DispatchQueue(label: "vclk.network"))
    }

    deinit { monitor.cancel() }
}

/// Комната ожидания: единственное место до комнаты общения, где включается превью камеры/микрофона.
/// Для запланированной встречи имя берётся из профиля; для свободной комнаты нужен код комнаты.
@MainActor
struct WaitingRoomView: View {
    @EnvironmentObject var model: AppModel
    let target: JoinTarget

    @State private var username = ""
    @State private var roomCode = ""
    @State private var title: String?
    @State private var micOn = true
    @State private var cameraOn = true
    @State private var frontCamera = true
    @State private var avatar: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var joining = false
    @State private var error: String?
    @State private var cameraAllowed = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    @State private var micAllowed = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    @State private var previewTrack: LocalVideoTrack?
    @StateObject private var network = NetworkInfo()

    private var isMeeting: Bool { target.meetingId != nil }

    private var canSubmit: Bool {
        isMeeting
            ? !username.trimmingCharacters(in: .whitespaces).isEmpty
            : canJoin(room: roomCode, username: username)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Button { model.closeWaiting() } label: { Image(systemName: "chevron.left") }
                    VStack(alignment: .leading) {
                        Text("Комната ожидания").font(.title3.weight(.semibold))
                        Text(isMeeting ? (title ?? "Встреча") : "Свободная комната")
                            .font(.subheadline)
                            .foregroundColor(Theme.muted)
                    }
                }

                preview

                HStack(spacing: 16) {
                    circleButton(micOn && micAllowed ? "mic.fill" : "mic.slash.fill", active: micOn && micAllowed) {
                        if micAllowed { micOn.toggle() } else { Task { await requestPermissions() } }
                    }
                    circleButton(cameraOn && cameraAllowed ? "video.fill" : "video.slash.fill", active: cameraOn && cameraAllowed) {
                        if cameraAllowed {
                            cameraOn.toggle()
                            Task { if cameraOn { await startPreview() } else { await stopPreview() } }
                        } else {
                            Task { await requestPermissions() }
                        }
                    }
                    circleButton("arrow.triangle.2.circlepath.camera", active: false) {
                        frontCamera.toggle()
                        Task { await flipPreview() }
                    }
                    .opacity(cameraOn && cameraAllowed ? 1 : 0.4)
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Image(systemName: "person.crop.circle.badge.plus")
                            .font(.title3)
                            .frame(width: 48, height: 48)
                            .background(Theme.surfaceHigh)
                            .clipShape(Circle())
                    }
                }
                .frame(maxWidth: .infinity)

                Text("Фото профиля показывается другим участникам, когда выключена камера.")
                    .font(.footnote)
                    .foregroundColor(Theme.muted)

                TextField("Ваше имя", text: $username).textFieldStyle(.roundedBorder)
                if !isMeeting {
                    TextField("Код комнаты", text: $roomCode)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Проверка устройства").font(.subheadline.weight(.semibold))
                    diagnosticRow("Камера", cameraAllowed ? "разрешена" : "нет доступа", ok: cameraAllowed)
                    diagnosticRow("Микрофон", micAllowed ? "разрешён" : "нет доступа", ok: micAllowed)
                    diagnosticRow("Сеть", network.text, ok: network.ok)
                    if !cameraAllowed || !micAllowed {
                        Button("Открыть настройки разрешений") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .font(.footnote)
                    }
                }
                .cardStyle()

                ErrorText(message: error)
                Button(action: join) {
                    if joining {
                        ProgressView().tint(.white)
                    } else {
                        Text(isMeeting ? "Подключиться к встрече" : "Войти в комнату")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit || joining)
                .opacity(canSubmit && !joining ? 1 : 0.5)
            }
            .padding(16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .task {
            username = model.user?.displayName ?? ""
            roomCode = target.roomCode
            title = target.title
            if target.meetingId != nil && title == nil, let id = target.meetingId {
                if let meeting = try? await model.api.meeting(id: id) { title = meeting.title }
            }
            await requestPermissions()
            await startPreview()
        }
        .onChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    avatar = image
                }
            }
        }
        .onDisappear { Task { await stopPreview() } }
    }

    // MARK: - Элементы

    private var preview: some View {
        ZStack {
            Theme.surface
            if let track = previewTrack, cameraOn, cameraAllowed {
                SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: .auto)
            } else if let avatar {
                Image(uiImage: avatar)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 140, height: 140)
                    .clipShape(Circle())
            } else {
                Text(cameraAllowed ? "Камера выключена" : "Нет доступа к камере").foregroundColor(Theme.muted)
            }
            if let avatar, previewTrack != nil, cameraOn, cameraAllowed {
                Image(uiImage: avatar)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(Circle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(10)
            }
        }
        .frame(height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func circleButton(_ systemName: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.title3)
                .frame(width: 48, height: 48)
                .background(active ? Theme.primary : Theme.surfaceHigh)
                .foregroundColor(.white)
                .clipShape(Circle())
        }
    }

    private func diagnosticRow(_ label: String, _ value: String, ok: Bool) -> some View {
        HStack {
            Text(label).foregroundColor(Theme.muted)
            Spacer()
            Text(value).foregroundColor(ok ? Theme.success : Theme.danger)
        }
        .font(.subheadline)
    }

    // MARK: - Устройства

    private func requestPermissions() async {
        cameraAllowed = await AVCaptureDevice.requestAccess(for: .video)
        micAllowed = await AVCaptureDevice.requestAccess(for: .audio)
    }

    private func startPreview() async {
        guard cameraOn, cameraAllowed, previewTrack == nil else { return }
        let track = LocalVideoTrack.createCameraTrack(
            options: CameraCaptureOptions(position: frontCamera ? .front : .back)
        )
        previewTrack = track
        do {
            try await track.start()
        } catch {
            self.error = "Не удалось включить камеру: \(error.localizedDescription)"
        }
    }

    private func stopPreview() async {
        guard let track = previewTrack else { return }
        previewTrack = nil
        try? await track.stop()
    }

    private func flipPreview() async {
        guard let capturer = previewTrack?.capturer as? CameraCapturer else { return }
        _ = try? await capturer.switchCameraPosition()
    }

    // MARK: - Вход

    private func join() {
        if joining || !canSubmit { return }
        joining = true
        error = nil
        Task {
            // Камеру должна освободить комната общения.
            await stopPreview()
            do {
                try await model.startJoin(
                    target: JoinTarget(meetingId: target.meetingId, title: title, roomCode: roomCode),
                    username: username,
                    avatarJpeg: avatar.flatMap { makeAvatarJpeg($0) },
                    micEnabled: micOn && micAllowed,
                    cameraEnabled: cameraOn && cameraAllowed,
                    frontCamera: frontCamera
                )
            } catch {
                self.error = errorText(error)
                joining = false
                await startPreview()
            }
        }
    }
}
