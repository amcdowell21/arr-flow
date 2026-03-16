import SwiftUI

enum AppTheme {
    // MARK: - Colors

    static let orange = Color(hex: "FF6B35")
    static let peach = Color(hex: "FF9F7F")
    static let amber = Color(hex: "FFBA6B")
    static let coral = Color(hex: "FF7F6B")
    static let cream = Color(hex: "FFF8F2")
    static let warmWhite = Color(hex: "FFFAF5")

    static let textPrimary = Color(hex: "1A1A1A")
    static let textSecondary = Color(hex: "6B7280")
    static let textTertiary = Color(hex: "9CA3AF")

    static let cardBackground = Color.white
    static let cardBorder = Color(hex: "F3F4F6")

    static let success = Color(hex: "34D399")
    static let warning = Color(hex: "FBBF24")
    static let danger = Color(hex: "EF4444")

    // Pipeline bucket colors
    static let bucketActive = Color(hex: "FF6B35")
    static let bucketFutureQ1Q2 = Color(hex: "6366F1")
    static let bucketFutureQ3Q4 = Color(hex: "8B5CF6")
    static let bucketRenewal = Color(hex: "34D399")
    static let bucketUntagged = Color(hex: "9CA3AF")

    // MARK: - Gradients

    static let backgroundGradient = LinearGradient(
        colors: [warmWhite, cream.opacity(0.5), Color.white],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let orangeGradient = LinearGradient(
        colors: [orange, coral],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let softOrangeGradient = LinearGradient(
        colors: [peach.opacity(0.3), amber.opacity(0.2)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let bobGradient = LinearGradient(
        colors: [orange, amber, peach],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    // MARK: - Shadows

    static let cardShadow = Color.black.opacity(0.04)
    static let elevatedShadow = Color.black.opacity(0.08)

    // MARK: - Card Style

    static func cardStyle() -> some ViewModifier {
        CardModifier()
    }
}

// MARK: - View Modifiers

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(AppTheme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: AppTheme.cardShadow, radius: 8, x: 0, y: 2)
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}

// MARK: - Color Hex Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
