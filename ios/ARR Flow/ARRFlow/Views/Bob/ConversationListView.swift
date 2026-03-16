import SwiftUI

struct ConversationListView: View {
    @EnvironmentObject var bobVM: BobViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                if bobVM.conversations.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 40))
                            .foregroundStyle(AppTheme.textTertiary)

                        Text("No conversations yet")
                            .font(.system(size: 16))
                            .foregroundStyle(AppTheme.textSecondary)

                        Text("Start chatting with Bob to see your history here")
                            .font(.system(size: 14))
                            .foregroundStyle(AppTheme.textTertiary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(40)
                } else {
                    List {
                        ForEach(bobVM.conversations) { conversation in
                            Button {
                                bobVM.loadConversation(conversation)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(conversation.title)
                                            .font(.system(size: 15, weight: .medium))
                                            .foregroundStyle(AppTheme.textPrimary)
                                            .lineLimit(1)

                                        Spacer()

                                        Text(conversation.updatedAt, style: .relative)
                                            .font(.system(size: 12))
                                            .foregroundStyle(AppTheme.textTertiary)
                                    }

                                    Text(conversation.preview)
                                        .font(.system(size: 13))
                                        .foregroundStyle(AppTheme.textSecondary)
                                        .lineLimit(2)

                                    Text("\(conversation.messages.count) messages")
                                        .font(.system(size: 11))
                                        .foregroundStyle(AppTheme.textTertiary)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                let conversation = bobVM.conversations[index]
                                Task { await bobVM.deleteConversation(conversation) }
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Conversations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(AppTheme.orange)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        bobVM.newConversation()
                        dismiss()
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(AppTheme.orange)
                    }
                }
            }
            .task { await bobVM.loadConversations() }
        }
    }
}
