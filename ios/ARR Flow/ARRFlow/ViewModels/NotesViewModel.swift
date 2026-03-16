import Foundation

@MainActor
class NotesViewModel: ObservableObject {
    @Published var notes: UserNotes?
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var selectedBlockIndex: Int?
    @Published var showBlockMenu = false

    private let service = FirestoreService.shared
    private var saveTask: Task<Void, Never>?

    var blocks: [NoteBlock] {
        get { notes?.blocks ?? [] }
        set {
            notes?.blocks = newValue
            debounceSave()
        }
    }

    var followUps: [FollowUp] {
        notes?.followUps ?? []
    }

    var pendingFollowUps: [FollowUp] {
        followUps.filter { !$0.completed }.sorted { $0.dueDate < $1.dueDate }
    }

    var todayFollowUps: [FollowUp] {
        let calendar = Calendar.current
        return pendingFollowUps.filter { calendar.isDateInToday($0.dueDate) }
    }

    func load() async {
        guard let uid = AuthService.shared.currentUserId else { return }
        isLoading = true
        do {
            notes = try await service.fetchNotes(userId: uid)
            if notes == nil {
                notes = UserNotes(title: "My Notes", blocks: [NoteBlock(type: .text, content: "")], followUps: [])
            }
        } catch {
            print("Failed to load notes: \(error)")
        }
        isLoading = false
    }

    func addBlock(after index: Int, type: BlockType = .text) {
        let newBlock = NoteBlock(type: type, content: "", checked: type == .todo ? false : nil)
        var updated = blocks
        updated.insert(newBlock, at: min(index + 1, updated.count))
        blocks = updated
        selectedBlockIndex = index + 1
    }

    func deleteBlock(at index: Int) {
        guard blocks.count > 1 else { return }
        var updated = blocks
        updated.remove(at: index)
        blocks = updated
    }

    func changeBlockType(at index: Int, to type: BlockType) {
        var updated = blocks
        updated[index].type = type
        if type == .todo { updated[index].checked = false }
        else { updated[index].checked = nil }
        blocks = updated
        showBlockMenu = false
    }

    func toggleTodo(at index: Int) {
        var updated = blocks
        updated[index].checked?.toggle()
        blocks = updated
    }

    func updateBlockContent(at index: Int, content: String) {
        guard index < blocks.count else { return }
        var updated = blocks
        updated[index].content = content
        notes?.blocks = updated
        debounceSave()
    }

    func toggleFollowUp(_ followUp: FollowUp) {
        guard var fus = notes?.followUps,
              let idx = fus.firstIndex(where: { $0.id == followUp.id }) else { return }
        fus[idx].completed.toggle()
        notes?.followUps = fus
        debounceSave()
    }

    private func debounceSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5s debounce
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    func save() async {
        guard let uid = AuthService.shared.currentUserId,
              let notes else { return }
        isSaving = true
        do {
            try await service.saveNotes(userId: uid, notes: notes)
        } catch {
            print("Failed to save notes: \(error)")
        }
        isSaving = false
    }
}
