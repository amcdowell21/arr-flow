import SwiftUI

struct FloatingOrbsView: View {
    @State private var animate = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Large warm orb - top right
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [AppTheme.orange.opacity(0.15), AppTheme.peach.opacity(0.05), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 150
                        )
                    )
                    .frame(width: 300, height: 300)
                    .offset(
                        x: geo.size.width * 0.3 + (animate ? 20 : -20),
                        y: -geo.size.height * 0.1 + (animate ? 30 : -10)
                    )

                // Medium peach orb - left
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [AppTheme.peach.opacity(0.12), AppTheme.amber.opacity(0.04), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 120
                        )
                    )
                    .frame(width: 240, height: 240)
                    .offset(
                        x: -geo.size.width * 0.25 + (animate ? -15 : 15),
                        y: geo.size.height * 0.15 + (animate ? -20 : 20)
                    )

                // Small amber orb - bottom right
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [AppTheme.amber.opacity(0.1), AppTheme.orange.opacity(0.03), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 80
                        )
                    )
                    .frame(width: 160, height: 160)
                    .offset(
                        x: geo.size.width * 0.2 + (animate ? 10 : -10),
                        y: geo.size.height * 0.35 + (animate ? 15 : -15)
                    )

                // Tiny accent orb - center left
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [AppTheme.coral.opacity(0.08), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 50
                        )
                    )
                    .frame(width: 100, height: 100)
                    .offset(
                        x: -geo.size.width * 0.1 + (animate ? 25 : -5),
                        y: -geo.size.height * 0.25 + (animate ? -10 : 15)
                    )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            withAnimation(
                .easeInOut(duration: 8)
                .repeatForever(autoreverses: true)
            ) {
                animate = true
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Bob Orb (animated avatar)

struct BobOrbView: View {
    let isActive: Bool
    var size: CGFloat = 80
    @State private var pulse = false
    @State private var rotate = false

    var body: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            AppTheme.orange.opacity(isActive ? 0.3 : 0.15),
                            AppTheme.peach.opacity(0.05),
                            .clear
                        ],
                        center: .center,
                        startRadius: size * 0.3,
                        endRadius: size * 0.8
                    )
                )
                .frame(width: size * 1.8, height: size * 1.8)
                .scaleEffect(pulse ? 1.1 : 1.0)

            // Middle ring
            Circle()
                .stroke(
                    AngularGradient(
                        colors: [AppTheme.orange.opacity(0.4), AppTheme.amber.opacity(0.2), AppTheme.peach.opacity(0.4), AppTheme.orange.opacity(0.4)],
                        center: .center
                    ),
                    lineWidth: 2
                )
                .frame(width: size * 1.2, height: size * 1.2)
                .rotationEffect(.degrees(rotate ? 360 : 0))

            // Core orb
            Circle()
                .fill(AppTheme.orangeGradient)
                .frame(width: size, height: size)
                .shadow(color: AppTheme.orange.opacity(0.3), radius: 12, x: 0, y: 4)

            // Icon
            Image(systemName: isActive ? "waveform" : "sparkles")
                .font(.system(size: size * 0.3, weight: .semibold))
                .foregroundStyle(.white)
                .symbolEffect(.variableColor, isActive: isActive)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
                pulse = true
            }
            withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
                rotate = true
            }
        }
    }
}
