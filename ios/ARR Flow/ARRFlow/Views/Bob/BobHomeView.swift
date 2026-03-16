import SwiftUI

struct BobHomeView: View {
    @EnvironmentObject var bobVM: BobViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()
                FloatingOrbsView()

                switch bobVM.mode {
                case .idle:
                    BobIdleView()
                        .environmentObject(bobVM)
                case .chat:
                    BobChatView()
                        .environmentObject(bobVM)
                case .call:
                    BobCallView()
                        .environmentObject(bobVM)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        bobVM.showConversationList = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }

                ToolbarItem(placement: .principal) {
                    Text(bobVM.mode == .idle ? "Bob" : (bobVM.mode == .call ? "On Call" : "Chat with Bob"))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if bobVM.mode != .idle {
                        Button {
                            withAnimation(.spring(response: 0.3)) {
                                if bobVM.mode == .call {
                                    bobVM.endCall()
                                } else {
                                    bobVM.newConversation()
                                }
                            }
                        } label: {
                            Image(systemName: "plus.circle")
                                .foregroundStyle(AppTheme.orange)
                        }
                    }
                }
            }
            .sheet(isPresented: $bobVM.showConversationList) {
                ConversationListView()
                    .environmentObject(bobVM)
            }
        }
    }
}

// MARK: - Idle State (Home)

struct BobIdleView: View {
    @EnvironmentObject var bobVM: BobViewModel
    @State private var greeting = ""

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Bob orb
            BobOrbView(isActive: false, size: 90)
                .padding(.bottom, 24)

            // Greeting
            Text(greeting)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(.bottom, 6)

            Text("How can I help you today?")
                .font(.system(size: 16))
                .foregroundStyle(AppTheme.textSecondary)
                .padding(.bottom, 40)

            // Action buttons
            HStack(spacing: 20) {
                // Chat button
                Button {
                    withAnimation(.spring(response: 0.3)) {
                        bobVM.mode = .chat
                    }
                } label: {
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(AppTheme.orange.opacity(0.1))
                                .frame(width: 64, height: 64)
                            Image(systemName: "bubble.left.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(AppTheme.orange)
                        }
                        Text("Chat")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                    .frame(width: 120, height: 120)
                    .background(AppTheme.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .shadow(color: AppTheme.cardShadow, radius: 8, x: 0, y: 2)
                }

                // Call button
                Button {
                    Task {
                        withAnimation(.spring(response: 0.3)) {
                            bobVM.mode = .call
                        }
                        await bobVM.startCall()
                    }
                } label: {
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(AppTheme.success.opacity(0.1))
                                .frame(width: 64, height: 64)
                            Image(systemName: "phone.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(AppTheme.success)
                        }
                        Text("Call")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                    .frame(width: 120, height: 120)
                    .background(AppTheme.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .shadow(color: AppTheme.cardShadow, radius: 8, x: 0, y: 2)
                }
            }

            Spacer()

            // Quick suggestions
            VStack(spacing: 8) {
                Text("Try asking")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textTertiary)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        SuggestionChip("Show my active deals")
                        SuggestionChip("What follow-ups are due?")
                        SuggestionChip("Sync HubSpot")
                        SuggestionChip("Create a new deal")
                    }
                    .padding(.horizontal, 20)
                }
            }
            .padding(.bottom, 20)
        }
        .onAppear {
            greeting = timeBasedGreeting()
        }
    }

    private func timeBasedGreeting() -> String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 0..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }
}

struct SuggestionChip: View {
    let text: String
    @EnvironmentObject var bobVM: BobViewModel

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Button {
            bobVM.inputText = text
            bobVM.mode = .chat
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                bobVM.sendMessage()
            }
        } label: {
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.orange)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(AppTheme.orange.opacity(0.08))
                .clipShape(Capsule())
        }
    }
}
