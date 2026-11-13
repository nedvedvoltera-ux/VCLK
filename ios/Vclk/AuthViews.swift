import SwiftUI

private struct AuthCard<Content: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String?
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(eyebrow.uppercased())
                    .font(.caption.weight(.semibold))
                    .foregroundColor(Theme.primary)
                Text(title).font(.title2.weight(.semibold))
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundColor(Theme.muted)
                }
                content
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
    }
}

/// Первый запуск: ввод адреса сервера.
@MainActor
struct ServerView: View {
    @EnvironmentObject var model: AppModel
    @State private var address = "https://"
    @State private var error: String?

    var body: some View {
        AuthCard(
            eyebrow: "VCLK",
            title: "Подключение к серверу",
            subtitle: "Укажите адрес вашего сервера видеовстреч. Его выдаёт администратор."
        ) {
            TextField("https://vclk.company.ru", text: $address)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: address) { _ in error = nil }
            ErrorText(message: error)
            Button("Продолжить") { error = model.setServer(address) }
                .buttonStyle(PrimaryButtonStyle())
        }
        .onAppear { if let url = model.serverUrl { address = url } }
    }
}

/// Вход, либо создание первого администратора, если система ещё не настроена.
@MainActor
struct AuthView: View {
    @EnvironmentObject var model: AppModel
    @State private var displayName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var ldap = false
    @State private var error: String?
    @State private var busy = false

    private var setup: Bool { model.modes.setupRequired }

    private var canSubmit: Bool {
        !busy && !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
            && (!setup || !displayName.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        AuthCard(
            eyebrow: "VCLK",
            title: setup ? "Создание администратора" : "Вход в VCLK",
            subtitle: setup
                ? "Первый аккаунт получит полный доступ к пользователям, календарю и интеграциям."
                : "Войдите в корпоративную систему видеовстреч."
        ) {
            if setup {
                TextField("Ваше имя", text: $displayName).textFieldStyle(.roundedBorder)
            }
            TextField("Корпоративный e-mail", text: $email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Пароль", text: $password).textFieldStyle(.roundedBorder)
            if !setup {
                Toggle("Войти через AD/LDAP", isOn: $ldap)
            }
            ErrorText(message: error ?? model.loadError)
            Button(action: submit) {
                if busy { ProgressView().tint(.white) } else { Text(setup ? "Создать администратора" : "Войти") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!canSubmit)
            .opacity(canSubmit ? 1 : 0.5)

            if !setup && model.modes.freeMode {
                Button("Войти в свободную комнату без учётной записи") {
                    model.openWaiting(JoinTarget())
                }
                .frame(maxWidth: .infinity)
            }
            Divider()
            HStack {
                Text((model.serverUrl ?? "")
                    .replacingOccurrences(of: "https://", with: "")
                    .replacingOccurrences(of: "http://", with: ""))
                    .font(.footnote)
                    .foregroundColor(Theme.muted)
                Spacer()
                Button("Сменить сервер") { model.changeServer() }.font(.footnote)
            }
        }
    }

    private func submit() {
        if busy { return }
        if password.count < 10 {
            error = "Пароль должен содержать минимум 10 символов"
            return
        }
        busy = true
        error = nil
        Task {
            do {
                if setup {
                    try await model.setupAdmin(email: email, password: password, displayName: displayName)
                } else {
                    try await model.login(email: email, password: password, ldap: ldap)
                }
            } catch {
                self.error = errorText(error)
            }
            busy = false
        }
    }
}

/// Активация персонального приглашения (`/invite/<token>`).
@MainActor
struct InviteView: View {
    @EnvironmentObject var model: AppModel
    let token: String
    @State private var invite: InviteInfo?
    @State private var displayName = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    private var subtitle: String? {
        guard let invite else { return nil }
        let when = (invite.startsAt?.isEmpty == false) ? formatDateTime(invite.startsAt ?? "") : "встречу"
        return "Вы приглашены на \(when). Активируйте доступ для \(invite.email)."
    }

    private var canSubmit: Bool {
        invite != nil && !busy && !displayName.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        AuthCard(
            eyebrow: "Приглашение VCLK",
            title: invite?.title ?? "Проверяем приглашение…",
            subtitle: subtitle
        ) {
            TextField("Ваше имя", text: $displayName).textFieldStyle(.roundedBorder)
            SecureField("Создайте пароль (от 10 символов)", text: $password).textFieldStyle(.roundedBorder)
            ErrorText(message: error)
            Button("Активировать и подключиться", action: activate)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
                .opacity(canSubmit ? 1 : 0.5)
            Button("Отмена") { model.cancelInvite() }.frame(maxWidth: .infinity)
        }
        .task {
            do {
                invite = try await model.api.inviteInfo(token: token)
            } catch {
                self.error = errorText(error)
            }
        }
    }

    private func activate() {
        if password.count < 10 {
            error = "Пароль должен содержать минимум 10 символов"
            return
        }
        busy = true
        error = nil
        Task {
            do {
                let result = try await model.api.activateInvite(
                    token: token,
                    displayName: displayName.trimmingCharacters(in: .whitespaces),
                    password: password
                )
                model.finishInviteActivation(user: result.user, meetingId: result.meetingId)
            } catch {
                self.error = errorText(error)
            }
            busy = false
        }
    }
}
