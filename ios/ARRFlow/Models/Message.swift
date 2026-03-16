import Foundation

struct Message: Identifiable, Codable, Equatable {
    let id: String
    let role: MessageRole
    var content: String
    let timestamp: Date
    var toolCalls: [ToolCall]?
    var isStreaming: Bool = false

    init(id: String = UUID().uuidString, role: MessageRole, content: String, timestamp: Date = Date(), toolCalls: [ToolCall]? = nil, isStreaming: Bool = false) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.toolCalls = toolCalls
        self.isStreaming = isStreaming
    }

    static func == (lhs: Message, rhs: Message) -> Bool {
        lhs.id == rhs.id && lhs.content == rhs.content && lhs.isStreaming == rhs.isStreaming
    }
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct ToolCall: Identifiable, Codable, Equatable {
    let id: String
    let name: String
    var status: ToolStatus

    enum ToolStatus: String, Codable {
        case running
        case completed
        case error
    }
}

// Friendly display names for tools
extension ToolCall {
    var displayName: String {
        switch name {
        case "list_deals": return "Searching deals"
        case "update_deal": return "Updating deal"
        case "create_deal": return "Creating deal"
        case "delete_deal": return "Deleting deal"
        case "list_events": return "Loading events"
        case "create_event": return "Creating event"
        case "list_outbound": return "Loading outbound"
        case "create_outbound": return "Logging outbound"
        case "read_notes": return "Reading notes"
        case "update_notes": return "Updating notes"
        case "add_follow_up": return "Adding follow-up"
        case "complete_follow_up": return "Completing follow-up"
        case "search_hubspot_deals": return "Searching HubSpot"
        case "get_deal_contacts": return "Loading contacts"
        case "get_deal_notes": return "Loading deal notes"
        case "sync_hubspot": return "Syncing HubSpot"
        default: return name.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
