import Foundation

enum BobMode {
    case idle
    case chat
    case call
}

@MainActor
class BobViewModel: ObservableObject {
    @Published var mode: BobMode = .idle
    @Published var messages: [Message] = []
    @Published var inputText = ""
    @Published var isStreaming = false
    @Published var activeTools: [ToolCall] = []
    @Published var conversations: [Conversation] = []
    @Published var currentConversationId: String?
    @Published var showConversationList = false
    @Published var errorMessage: String?

    @Published var voiceService = VoiceCallService.shared

    private var currentTask: URLSessionDataTask?
    private let chatService = BobChatService.shared
    private let firestoreService = FirestoreService.shared

    var userId: String? {
        AuthService.shared.currentUserId
    }

    // MARK: - Chat

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }

        inputText = ""
        mode = .chat

        let userMessage = Message(role: .user, content: text)
        messages.append(userMessage)

        // Create assistant placeholder
        let assistantMessage = Message(role: .assistant, content: "", isStreaming: true)
        messages.append(assistantMessage)
        isStreaming = true
        activeTools = []

        let apiMessages = messages
            .filter { !$0.isStreaming && !$0.content.isEmpty }
            .map { ["role": $0.role.rawValue, "content": $0.content] }

        guard let uid = userId else { return }

        currentTask = chatService.sendMessage(
            messages: apiMessages,
            userId: uid,
            conversationId: currentConversationId,
            onDelta: { [weak self] delta in
                guard let self else { return }
                if let lastIndex = self.messages.indices.last,
                   self.messages[lastIndex].role == .assistant {
                    self.messages[lastIndex].content += delta
                }
            },
            onTool: { [weak self] tool in
                guard let self else { return }
                if let idx = self.activeTools.firstIndex(where: { $0.id == tool.id }) {
                    self.activeTools[idx] = tool
                } else {
                    self.activeTools.append(tool)
                }
            },
            onConversationId: { [weak self] id in
                self?.currentConversationId = id
            },
            onDone: { [weak self] in
                guard let self else { return }
                if let lastIndex = self.messages.indices.last {
                    self.messages[lastIndex].isStreaming = false
                }
                self.isStreaming = false
                self.activeTools = []
            },
            onError: { [weak self] error in
                self?.isStreaming = false
                self?.errorMessage = error.localizedDescription
                self?.activeTools = []
            }
        )
    }

    func stopStreaming() {
        currentTask?.cancel()
        currentTask = nil
        isStreaming = false
        if let lastIndex = messages.indices.last {
            messages[lastIndex].isStreaming = false
        }
        activeTools = []
    }

    // MARK: - Voice Call

    func startCall() async {
        guard let uid = userId else { return }
        mode = .call
        do {
            try await voiceService.startCall(userId: uid)
        } catch {
            errorMessage = error.localizedDescription
            mode = messages.isEmpty ? .idle : .chat
        }
    }

    func endCall() {
        voiceService.endCall()
        // Add transcript to messages
        for entry in voiceService.transcript {
            let role: MessageRole = entry.role == "user" ? .user : .assistant
            messages.append(Message(role: role, content: entry.text, timestamp: entry.timestamp))
        }
        mode = messages.isEmpty ? .idle : .chat
    }

    // MARK: - Conversations

    func loadConversations() async {
        guard let uid = userId else { return }
        do {
            conversations = try await firestoreService.fetchConversations(userId: uid)
        } catch {
            print("Failed to load conversations: \(error)")
        }
    }

    func loadConversation(_ conversation: Conversation) {
        currentConversationId = conversation.id
        messages = conversation.messages
        mode = .chat
        showConversationList = false
    }

    func newConversation() {
        currentConversationId = nil
        messages = []
        mode = .idle
        showConversationList = false
    }

    func deleteConversation(_ conversation: Conversation) async {
        do {
            try await firestoreService.deleteConversation(id: conversation.id)
            conversations.removeAll { $0.id == conversation.id }
            if currentConversationId == conversation.id {
                newConversation()
            }
        } catch {
            print("Failed to delete conversation: \(error)")
        }
    }
}
