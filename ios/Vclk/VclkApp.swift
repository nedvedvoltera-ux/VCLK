import SwiftUI

@main
struct VclkApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .tint(Theme.primary)
                .onOpenURL { model.handleLink($0) }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            Theme.background.ignoresSafeArea()
            root
            if let toast = model.toast {
                ToastView(toast: toast)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: toast.id) {
                        try? await Task.sleep(nanoseconds: 3_500_000_000)
                        if model.toast?.id == toast.id { model.toast = nil }
                    }
                    .onTapGesture { model.toast = nil }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.toast)
    }

    @ViewBuilder
    private var root: some View {
        if model.serverUrl == nil {
            ServerView()
        } else if model.checking {
            ProgressView()
        } else if let token = model.inviteToken {
            InviteView(token: token)
        } else if let session = model.roomSession {
            RoomView(session: session, model: model)
        } else if let target = model.joinTarget, model.user != nil || target.meetingId == nil {
            // Свободная комната доступна и без учётной записи.
            WaitingRoomView(target: target)
        } else if model.user == nil {
            AuthView()
        } else {
            MainView()
        }
    }
}
