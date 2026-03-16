import Foundation

struct Conversation: Identifiable, Codable {
    let id: String
    var title: String
    var messages: [Message]
    let userId: String
    let createdAt: Date
    var updatedAt: Date

    var lastMessage: String {
        messages.last(where: { $0.role == .assistant })?.content ?? "New conversation"
    }

    var preview: String {
        let text = lastMessage
        return text.count > 80 ? String(text.prefix(80)) + "..." : text
    }
}
