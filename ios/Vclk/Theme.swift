import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

enum Theme {
    static let background = Color(hex: 0x0F1720)
    static let surface = Color(hex: 0x17222E)
    static let surfaceHigh = Color(hex: 0x1F2D3B)
    static let primary = Color(hex: 0x4C84FF)
    static let outline = Color(hex: 0x33465A)
    static let muted = Color(hex: 0x9FB0C3)
    static let danger = Color(hex: 0xFF6B6B)
    static let success = Color(hex: 0x4CD08A)
    static let rec = Color(hex: 0xE5484D)
    static let text = Color(hex: 0xE8EEF5)
}

extension View {
    /// Карточка в стиле веб-интерфейса.
    func cardStyle(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.outline, lineWidth: 1))
    }
}

/// Текст с кликабельными ссылками и e-mail (поведение как в описании встречи в вебе).
struct LinkedText: View {
    let text: String

    var body: some View {
        Text(attributed)
            .tint(Theme.primary)
    }

    private var attributed: AttributedString {
        var result = AttributedString()
        for token in tokenizeLinks(text) {
            var part = AttributedString(token.text)
            if let href = token.href, let url = URL(string: href) {
                part.link = url
            }
            result.append(part)
        }
        return result
    }
}

struct ErrorText: View {
    let message: String?

    var body: some View {
        if let message, !message.isEmpty {
            Text(message)
                .font(.footnote)
                .foregroundColor(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var danger = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background((danger ? Theme.danger : Theme.primary).opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct ToastView: View {
    let toast: ToastMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(toast.title).font(.subheadline.weight(.semibold))
            if let detail = toast.detail, !detail.isEmpty {
                Text(detail).font(.footnote).foregroundColor(Theme.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(toast.isError ? Theme.danger.opacity(0.25) : Theme.surfaceHigh)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.outline, lineWidth: 1))
        .padding(.horizontal, 12)
    }
}
