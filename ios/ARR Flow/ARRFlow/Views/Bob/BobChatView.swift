import SwiftUI

struct BobChatView: View {
    @EnvironmentObject var bobVM: BobViewModel
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(bobVM.messages) { message in
                            ChatMessageView(message: message)
                                .id(message.id)
                        }

                        // Active tool indicators
                        if !bobVM.activeTools.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(bobVM.activeTools) { tool in
                                    ToolStatusView(tool: tool)
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                    .padding(.vertical, 16)
                }
                .onChange(of: bobVM.messages.count) { _, _ in
                    if let last = bobVM.messages.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
                .onChange(of: bobVM.messages.last?.content) { _, _ in
                    if let last = bobVM.messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onTapGesture { inputFocused = false }

            // Error banner
            if let error = bobVM.errorMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Spacer()
                    Button {
                        bobVM.errorMessage = nil
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.red.opacity(0.08))
                .overlay(Rectangle().frame(height: 1), alignment: .top)
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                // Switch to call
                Button {
                    Task { await bobVM.startCall() }
                } label: {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(AppTheme.success)
                        .frame(width: 36, height: 36)
                }

                // Text field
                HStack {
                    TextField("Message Bob...", text: $bobVM.inputText, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($inputFocused)
                        .onSubmit { bobVM.sendMessage() }

                    if bobVM.isStreaming {
                        Button { bobVM.stopStreaming() } label: {
                            Image(systemName: "stop.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(AppTheme.danger)
                        }
                    } else {
                        Button { bobVM.sendMessage() } label: {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 26))
                                .foregroundStyle(
                                    bobVM.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    ? AppTheme.textTertiary
                                    : AppTheme.orange
                                )
                        }
                        .disabled(bobVM.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color(hex: "F9FAFB"))
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(AppTheme.cardBorder, lineWidth: 1)
                )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }
}

// MARK: - Chat Message Bubble

struct ChatMessageView: View {
    let message: Message
    let isUser: Bool

    init(message: Message) {
        self.message = message
        self.isUser = message.role == .user
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if isUser { Spacer(minLength: 48) }

            if !isUser {
                // Bob avatar
                ZStack {
                    Circle()
                        .fill(AppTheme.orangeGradient)
                        .frame(width: 30, height: 30)
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                if message.content.isEmpty && message.isStreaming {
                    TypingIndicator()
                } else {
                    MarkdownTextView(text: message.content)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(isUser ? AppTheme.orange : AppTheme.cardBackground)
                        .foregroundStyle(isUser ? .white : AppTheme.textPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .shadow(color: isUser ? .clear : AppTheme.cardShadow, radius: 4, x: 0, y: 1)
                }

                Text(message.timestamp, style: .time)
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.textTertiary)
            }

            if !isUser { Spacer(minLength: 48) }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var phase = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(AppTheme.textTertiary)
                    .frame(width: 7, height: 7)
                    .scaleEffect(phase == i ? 1.3 : 1.0)
                    .opacity(phase == i ? 1.0 : 0.4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: AppTheme.cardShadow, radius: 4, x: 0, y: 1)
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
                withAnimation(.easeInOut(duration: 0.3)) {
                    phase = (phase + 1) % 3
                }
            }
        }
    }
}

// MARK: - Tool Status Badge

struct ToolStatusView: View {
    let tool: ToolCall

    var body: some View {
        HStack(spacing: 8) {
            if tool.status == .running {
                ProgressView()
                    .scaleEffect(0.7)
                    .tint(AppTheme.orange)
            } else {
                Image(systemName: tool.status == .completed ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(tool.status == .completed ? AppTheme.success : AppTheme.danger)
            }

            Text(tool.displayName)
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(hex: "F9FAFB"))
        .clipShape(Capsule())
    }
}

// MARK: - Simple Markdown Renderer

struct MarkdownTextView: View {
    let text: String

    var body: some View {
        Text(parseMarkdown(text))
            .font(.system(size: 15))
            .lineSpacing(2)
    }

    private func parseMarkdown(_ input: String) -> AttributedString {
        // Use iOS built-in markdown parsing
        if let attributed = try? AttributedString(markdown: input, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return attributed
        }
        return AttributedString(input)
    }
}
