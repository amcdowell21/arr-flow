import Foundation

struct NoteBlock: Identifiable, Codable {
    let id: String
    var type: BlockType
    var content: String
    var checked: Bool?

    init(id: String = UUID().uuidString, type: BlockType = .text, content: String = "", checked: Bool? = nil) {
        self.id = id
        self.type = type
        self.content = content
        self.checked = checked
    }
}

enum BlockType: String, Codable, CaseIterable {
    case text
    case h1
    case h2
    case h3
    case bullet
    case numbered
    case todo
    case quote
    case code
    case divider

    var label: String {
        switch self {
        case .text: return "Text"
        case .h1: return "Heading 1"
        case .h2: return "Heading 2"
        case .h3: return "Heading 3"
        case .bullet: return "Bullet List"
        case .numbered: return "Numbered List"
        case .todo: return "To-do"
        case .quote: return "Quote"
        case .code: return "Code"
        case .divider: return "Divider"
        }
    }

    var icon: String {
        switch self {
        case .text: return "text.alignleft"
        case .h1: return "textformat.size.larger"
        case .h2: return "textformat.size"
        case .h3: return "textformat.size.smaller"
        case .bullet: return "list.bullet"
        case .numbered: return "list.number"
        case .todo: return "checkmark.square"
        case .quote: return "text.quote"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .divider: return "minus"
        }
    }
}

struct FollowUp: Identifiable, Codable {
    let id: String
    var task: String
    var dealId: String?
    var dealName: String?
    var dueDate: Date
    var completed: Bool
    var createdAt: Date

    init(id: String = UUID().uuidString, task: String, dealId: String? = nil, dealName: String? = nil, dueDate: Date, completed: Bool = false, createdAt: Date = Date()) {
        self.id = id
        self.task = task
        self.dealId = dealId
        self.dealName = dealName
        self.dueDate = dueDate
        self.completed = completed
        self.createdAt = createdAt
    }
}

struct UserNotes: Codable {
    var title: String
    var blocks: [NoteBlock]
    var followUps: [FollowUp]?
    var updatedAt: Date?
}
