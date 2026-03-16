import SwiftUI

struct NotesView: View {
    @EnvironmentObject var notesVM: NotesViewModel
    @State private var showFollowUps = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                if notesVM.isLoading {
                    ProgressView()
                        .tint(AppTheme.orange)
                } else {
                    VStack(spacing: 0) {
                        // Follow-ups banner
                        if !notesVM.todayFollowUps.isEmpty {
                            Button { showFollowUps = true } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "bell.badge.fill")
                                        .foregroundStyle(AppTheme.orange)
                                    Text("\(notesVM.todayFollowUps.count) follow-up\(notesVM.todayFollowUps.count == 1 ? "" : "s") due today")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(AppTheme.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12))
                                        .foregroundStyle(AppTheme.textTertiary)
                                }
                                .padding(12)
                                .background(AppTheme.orange.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                        }

                        // Block editor
                        ScrollView {
                            LazyVStack(spacing: 2) {
                                ForEach(Array(notesVM.blocks.enumerated()), id: \.element.id) { index, block in
                                    BlockView(
                                        block: block,
                                        index: index,
                                        onUpdate: { content in
                                            notesVM.updateBlockContent(at: index, content: content)
                                        },
                                        onReturn: {
                                            notesVM.addBlock(after: index)
                                        },
                                        onDelete: {
                                            notesVM.deleteBlock(at: index)
                                        },
                                        onToggleTodo: {
                                            notesVM.toggleTodo(at: index)
                                        },
                                        onChangeType: { type in
                                            notesVM.changeBlockType(at: index, to: type)
                                        }
                                    )
                                }
                            }
                            .padding(.vertical, 12)
                        }
                    }
                }
            }
            .navigationTitle(notesVM.notes?.title ?? "Notes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        if notesVM.isSaving {
                            ProgressView().scaleEffect(0.7)
                        }
                        Button {
                            showFollowUps = true
                        } label: {
                            Image(systemName: "checklist")
                                .foregroundStyle(AppTheme.orange)
                        }
                    }
                }
            }
            .sheet(isPresented: $showFollowUps) {
                FollowUpsSheet()
                    .environmentObject(notesVM)
            }
            .task { await notesVM.load() }
        }
    }
}

// MARK: - Block View

struct BlockView: View {
    let block: NoteBlock
    let index: Int
    let onUpdate: (String) -> Void
    let onReturn: () -> Void
    let onDelete: () -> Void
    let onToggleTodo: () -> Void
    let onChangeType: (BlockType) -> Void

    @State private var text: String
    @State private var showTypeMenu = false

    init(block: NoteBlock, index: Int, onUpdate: @escaping (String) -> Void, onReturn: @escaping () -> Void, onDelete: @escaping () -> Void, onToggleTodo: @escaping () -> Void, onChangeType: @escaping (BlockType) -> Void) {
        self.block = block
        self.index = index
        self.onUpdate = onUpdate
        self.onReturn = onReturn
        self.onDelete = onDelete
        self.onToggleTodo = onToggleTodo
        self.onChangeType = onChangeType
        self._text = State(initialValue: block.content)
    }

    var body: some View {
        if block.type == .divider {
            Divider()
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .contextMenu { blockContextMenu }
        } else {
            HStack(alignment: .top, spacing: 8) {
                // Block type indicator / drag handle
                Button { showTypeMenu = true } label: {
                    blockPrefix
                }
                .popover(isPresented: $showTypeMenu) {
                    BlockTypeMenu(onSelect: onChangeType)
                }

                // Content
                TextField(placeholder, text: $text, axis: .vertical)
                    .font(blockFont)
                    .foregroundStyle(blockColor)
                    .onChange(of: text) { _, newVal in
                        onUpdate(newVal)
                    }
                    .onSubmit { onReturn() }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, block.type == .h1 ? 6 : 3)
            .contextMenu { blockContextMenu }
        }
    }

    @ViewBuilder
    var blockPrefix: some View {
        switch block.type {
        case .bullet:
            Text("\u{2022}")
                .font(.system(size: 18))
                .foregroundStyle(AppTheme.textTertiary)
                .frame(width: 24)
        case .numbered:
            Text("\(index + 1).")
                .font(.system(size: 14))
                .foregroundStyle(AppTheme.textTertiary)
                .frame(width: 24)
        case .todo:
            Image(systemName: block.checked == true ? "checkmark.square.fill" : "square")
                .font(.system(size: 18))
                .foregroundStyle(block.checked == true ? AppTheme.success : AppTheme.textTertiary)
                .frame(width: 24)
                .onTapGesture { onToggleTodo() }
        case .quote:
            Rectangle()
                .fill(AppTheme.orange.opacity(0.4))
                .frame(width: 3)
                .padding(.vertical, 2)
        case .code:
            Image(systemName: "chevron.left.forwardslash.chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.textTertiary)
                .frame(width: 24)
        default:
            Color.clear.frame(width: 24)
        }
    }

    var blockFont: Font {
        switch block.type {
        case .h1: return .system(size: 24, weight: .bold)
        case .h2: return .system(size: 20, weight: .semibold)
        case .h3: return .system(size: 17, weight: .semibold)
        case .code: return .system(size: 14, design: .monospaced)
        case .quote: return .system(size: 15).italic()
        default: return .system(size: 15)
        }
    }

    var blockColor: Color {
        if block.type == .todo && block.checked == true {
            return AppTheme.textTertiary
        }
        return AppTheme.textPrimary
    }

    var placeholder: String {
        switch block.type {
        case .h1: return "Heading 1"
        case .h2: return "Heading 2"
        case .h3: return "Heading 3"
        case .todo: return "To-do"
        default: return "Type something..."
        }
    }

    @ViewBuilder
    var blockContextMenu: some View {
        Button { onReturn() } label: {
            Label("Add Block Below", systemImage: "plus")
        }
        Menu("Change Type") {
            ForEach(BlockType.allCases, id: \.self) { type in
                Button {
                    onChangeType(type)
                } label: {
                    Label(type.label, systemImage: type.icon)
                }
            }
        }
        Button(role: .destructive) { onDelete() } label: {
            Label("Delete", systemImage: "trash")
        }
    }
}

// MARK: - Block Type Menu

struct BlockTypeMenu: View {
    let onSelect: (BlockType) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ForEach(BlockType.allCases, id: \.self) { type in
                Button {
                    onSelect(type)
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: type.icon)
                            .frame(width: 20)
                            .foregroundStyle(AppTheme.orange)
                        Text(type.label)
                            .foregroundStyle(AppTheme.textPrimary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
                if type != BlockType.allCases.last {
                    Divider()
                }
            }
        }
        .frame(width: 200)
        .presentationCompactAdaptation(.popover)
    }
}

// MARK: - Follow-Ups Sheet

struct FollowUpsSheet: View {
    @EnvironmentObject var notesVM: NotesViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                if notesVM.pendingFollowUps.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.circle")
                            .font(.system(size: 40))
                            .foregroundStyle(AppTheme.success)
                        Text("All caught up!")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                } else {
                    List {
                        ForEach(notesVM.pendingFollowUps) { followUp in
                            HStack(spacing: 12) {
                                Button {
                                    notesVM.toggleFollowUp(followUp)
                                } label: {
                                    Image(systemName: followUp.completed ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(followUp.completed ? AppTheme.success : AppTheme.textTertiary)
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(followUp.task)
                                        .font(.system(size: 15))
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .strikethrough(followUp.completed)

                                    HStack(spacing: 8) {
                                        if let dealName = followUp.dealName {
                                            Label(dealName, systemImage: "briefcase")
                                                .font(.system(size: 12))
                                                .foregroundStyle(AppTheme.orange)
                                        }

                                        Text(followUp.dueDate, style: .date)
                                            .font(.system(size: 12))
                                            .foregroundStyle(
                                                followUp.dueDate < Date() ? AppTheme.danger : AppTheme.textTertiary
                                            )
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Follow-ups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppTheme.orange)
                }
            }
        }
    }
}
