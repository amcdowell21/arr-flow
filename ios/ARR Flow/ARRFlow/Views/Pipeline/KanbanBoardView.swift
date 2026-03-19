import SwiftUI

struct KanbanBoardView: View {
    @EnvironmentObject var pipelineVM: PipelineViewModel
    @State private var selectedDeal: Deal?
    @State private var draggedDeal: Deal?

    var body: some View {
        GeometryReader { geo in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(DealBucket.allCases, id: \.self) { bucket in
                        PipelineKanbanColumn(
                            bucket: bucket,
                            deals: pipelineVM.deals.filter { $0.bucket == bucket },
                            columnHeight: geo.size.height - 20,
                            draggedDeal: $draggedDeal,
                            onTap: { deal in selectedDeal = deal },
                            onDrop: { deal in
                                Task { await pipelineVM.moveDeal(deal, toBucket: bucket) }
                            }
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
            }
        }
        .sheet(item: $selectedDeal) { deal in
            DealDetailView(deal: deal)
                .environmentObject(pipelineVM)
        }
    }
}

// MARK: - Kanban Column

struct PipelineKanbanColumn: View {
    let bucket: DealBucket
    let deals: [Deal]
    let columnHeight: CGFloat
    @Binding var draggedDeal: Deal?
    let onTap: (Deal) -> Void
    let onDrop: (Deal) -> Void

    @State private var isTargeted = false

    var openDeals: [Deal] { deals.filter { !$0.closedWon }.sorted { $0.value > $1.value } }
    var wonDeals: [Deal] { deals.filter { $0.closedWon }.sorted { $0.value > $1.value } }
    var totalValue: Double { openDeals.reduce(0) { $0 + $1.value } }
    var weightedValue: Double { openDeals.reduce(0) { $0 + $1.adjustedValue } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Column header
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Circle()
                        .fill(bucket.color)
                        .frame(width: 10, height: 10)
                    Text(bucket.label)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    Text("\(openDeals.count)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.textTertiary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color(hex: "F3F4F6"))
                        .clipShape(Capsule())
                }

                HStack(spacing: 12) {
                    Text(formatCurrency(totalValue))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(formatCurrency(weightedValue))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.amber)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isTargeted ? bucket.color : AppTheme.cardBorder, lineWidth: isTargeted ? 2 : 1)
                    )
            )

            // Deal cards
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 8) {
                    ForEach(openDeals) { deal in
                        PipelineKanbanCard(deal: deal)
                            .onTapGesture { onTap(deal) }
                            .draggable(deal.id) {
                                // Drag preview
                                PipelineKanbanCard(deal: deal)
                                    .frame(width: 240)
                                    .opacity(0.9)
                                    .onAppear { draggedDeal = deal }
                            }
                    }

                    if !wonDeals.isEmpty {
                        Text("Won (\(wonDeals.count))")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(AppTheme.success)
                            .padding(.top, 8)
                            .padding(.bottom, 4)

                        ForEach(wonDeals) { deal in
                            PipelineKanbanCard(deal: deal)
                                .opacity(0.7)
                                .onTapGesture { onTap(deal) }
                        }
                    }
                }
                .padding(.top, 10)
                .padding(.horizontal, 2)
            }
        }
        .frame(width: 260, height: max(columnHeight, 300))
        .dropDestination(for: String.self) { items, _ in
            guard let dealId = items.first,
                  let deal = draggedDeal, deal.id == dealId else { return false }
            if deal.bucket == bucket { return false }
            onDrop(deal)
            draggedDeal = nil
            return true
        } isTargeted: { targeted in
            isTargeted = targeted
        }
    }
}

// MARK: - Kanban Deal Card

struct PipelineKanbanCard: View {
    let deal: Deal

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(deal.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Spacer()
                if deal.closedWon {
                    Text("WON")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(AppTheme.success)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(AppTheme.success.opacity(0.1))
                        .clipShape(Capsule())
                }
            }

            HStack(spacing: 8) {
                Text(formatCurrency(deal.value))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)

                Spacer()

                Text("\(Int(deal.effectiveConfidence))%")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(
                        deal.effectiveConfidence >= 70 ? AppTheme.success :
                        deal.effectiveConfidence >= 40 ? AppTheme.warning : AppTheme.danger
                    )
            }

            if let month = deal.expectedCloseMonth {
                Text(formatMonthLabel(month))
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.textTertiary)
            }

            if let contact = deal.contactName, !contact.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "person")
                        .font(.system(size: 10))
                    Text(contact)
                        .font(.system(size: 11))
                        .lineLimit(1)
                }
                .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white)
                .shadow(color: Color.black.opacity(0.04), radius: 2, y: 1)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(AppTheme.cardBorder, lineWidth: 0.5)
        )
    }
}
