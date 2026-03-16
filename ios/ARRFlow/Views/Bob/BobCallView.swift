import SwiftUI

struct BobCallView: View {
    @EnvironmentObject var bobVM: BobViewModel
    @ObservedObject var voice: VoiceCallService

    init() {
        self.voice = VoiceCallService.shared
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Call orb with mic visualization
            ZStack {
                // Mic level rings
                ForEach(0..<3) { i in
                    Circle()
                        .stroke(AppTheme.orange.opacity(0.15 - Double(i) * 0.04), lineWidth: 2)
                        .frame(
                            width: 140 + CGFloat(i) * 40 + CGFloat(voice.micLevel) * 20,
                            height: 140 + CGFloat(i) * 40 + CGFloat(voice.micLevel) * 20
                        )
                        .animation(.easeOut(duration: 0.15), value: voice.micLevel)
                }

                BobOrbView(isActive: voice.isCallActive, size: 100)
            }

            // Status text
            VStack(spacing: 6) {
                if voice.isConnecting {
                    Text("Connecting...")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(AppTheme.textSecondary)
                } else if voice.isSpeaking {
                    Text("Bob is speaking")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(AppTheme.orange)
                } else if voice.isListening {
                    Text("Listening...")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(AppTheme.success)
                } else {
                    Text("Call with Bob")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(AppTheme.textPrimary)
                }

                if voice.isCallActive {
                    Text(voice.formattedDuration)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(AppTheme.textTertiary)
                }
            }
            .padding(.top, 24)

            Spacer()

            // Live transcript
            if !voice.transcript.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(voice.transcript) { entry in
                            HStack(alignment: .top, spacing: 8) {
                                Text(entry.role == "user" ? "You" : "Bob")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(entry.role == "user" ? AppTheme.textSecondary : AppTheme.orange)
                                    .frame(width: 32, alignment: .leading)

                                Text(entry.text)
                                    .font(.system(size: 14))
                                    .foregroundStyle(AppTheme.textPrimary)
                            }
                        }
                    }
                    .padding(16)
                }
                .frame(maxHeight: 200)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 20)
            }

            // End call button
            Button {
                withAnimation(.spring(response: 0.3)) {
                    bobVM.endCall()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(AppTheme.danger)
                        .frame(width: 72, height: 72)
                        .shadow(color: AppTheme.danger.opacity(0.3), radius: 12, x: 0, y: 4)

                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.white)
                }
            }
            .padding(.vertical, 32)
        }
    }
}
