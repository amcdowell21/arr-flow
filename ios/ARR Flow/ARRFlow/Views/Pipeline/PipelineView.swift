import SwiftUI

struct PipelineView: View {
    @EnvironmentObject var pipelineVM: PipelineViewModel
    @State private var selectedDeal: Deal?
    @State private var viewMode: ViewMode = .list

    enum ViewMode: String, CaseIterable {
        case list = "List"
        case board = "Board"

        var icon: String {
            switch self {
            case .list: return "list.bullet"
            case .board: return "rectangle.split.3x1"
            }
        }
    }

    // Group filtered deals by expectedCloseMonth, sorted chronologically.
    // Deals with no close month go in a "No Date" section at the end.
    var dealsByMonth: [(month: String, key: String, deals: [Deal])] {
        var groups: [String: [Deal]] = [:]
        for deal in pipelineVM.filteredDeals {
            let key = deal.expectedCloseMonth ?? "zzz"
            groups[key, default: []].append(deal)
        }
        return groups.keys.sorted().map { key in
            var monthDeals = groups[key]!
            monthDeals.sort { $0.value > $1.value }
            let label = key == "zzz" ? "No Date" : formatMonthLabel(key)
            return (label, key, monthDeals)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Fixed header: summary + toggle
                    VStack(spacing: 10) {
                        // View mode toggle + sync button
                        HStack(spacing: 8) {
                            Picker("View", selection: $viewMode) {
                                ForEach(ViewMode.allCases, id: \.self) { mode in
                                    Label(mode.rawValue, systemImage: mode.icon)
                                        .tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 180)

                            Spacer()

                            Button {
                                Task { await pipelineVM.syncFromHubSpot() }
                            } label: {
                                HStack(spacing: 4) {
                                    if pipelineVM.isSyncing {
                                        ProgressView()
                                            .scaleEffect(0.7)
                                    } else {
                                        Image(systemName: "arrow.triangle.2.circlepath")
                                            .font(.system(size: 12))
                                    }
                                    Text("Sync HS")
                                        .font(.system(size: 12, weight: .medium))
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(AppTheme.orange.opacity(0.1))
                                .foregroundStyle(AppTheme.orange)
                                .clipShape(Capsule())
                            }
                            .disabled(pipelineVM.isSyncing)
                        }

                        // Sync status
                        if let status = pipelineVM.syncStatus {
                            HStack(spacing: 6) {
                                Image(systemName: status.hasPrefix("Sync error") ? "exclamationmark.triangle" : "checkmark.circle")
                                    .font(.system(size: 12))
                                Text(status)
                                    .font(.system(size: 12))
                            }
                            .foregroundStyle(status.hasPrefix("Sync error") ? AppTheme.danger : AppTheme.success)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                    if viewMode == .list {
                        // List view - scrollable
                        ScrollView {
                            VStack(spacing: 16) {
                                // Summary cards
                                HStack(spacing: 12) {
                                    SummaryCard(
                                        title: "Total Pipeline",
                                        value: formatCurrency(pipelineVM.totalPipeline),
                                        icon: "chart.bar.fill",
                                        color: AppTheme.orange
                                    )
                                    SummaryCard(
                                        title: "Weighted",
                                        value: formatCurrency(pipelineVM.weightedPipeline),
                                        icon: "scale.3d",
                                        color: AppTheme.amber
                                    )
                                }
                                .padding(.horizontal, 16)

                                HStack(spacing: 12) {
                                    SummaryCard(
                                        title: "Closed Won",
                                        value: formatCurrency(pipelineVM.closedWon),
                                        icon: "trophy.fill",
                                        color: AppTheme.success
                                    )
                                    SummaryCard(
                                        title: "Active Deals",
                                        value: "\(pipelineVM.deals.filter { !$0.closedWon }.count)",
                                        icon: "number",
                                        color: AppTheme.bucketFutureQ1Q2
                                    )
                                }
                                .padding(.horizontal, 16)

                                // Bucket filter
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        BucketChip(label: "All", isSelected: pipelineVM.selectedBucket == nil) {
                                            pipelineVM.selectedBucket = nil
                                        }
                                        ForEach(DealBucket.allCases, id: \.self) { bucket in
                                            BucketChip(
                                                label: bucket.label,
                                                color: bucket.color,
                                                isSelected: pipelineVM.selectedBucket == bucket
                                            ) {
                                                pipelineVM.selectedBucket = bucket
                                            }
                                        }
                                    }
                                    .padding(.horizontal, 16)
                                }

                                // Search
                                HStack(spacing: 10) {
                                    Image(systemName: "magnifyingglass")
                                        .foregroundStyle(AppTheme.textTertiary)
                                    TextField("Search deals...", text: $pipelineVM.searchText)
                                }
                                .padding(12)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(AppTheme.cardBorder, lineWidth: 1)
                                )
                                .padding(.horizontal, 16)

                                // Deal count
                                HStack {
                                    Text("\(pipelineVM.filteredDeals.count) deal\(pipelineVM.filteredDeals.count == 1 ? "" : "s")")
                                        .font(.system(size: 13))
                                        .foregroundStyle(AppTheme.textTertiary)
                                    Spacer()
                                }
                                .padding(.horizontal, 16)

                                // Deals grouped by close month
                                if dealsByMonth.isEmpty {
                                    Text("No deals found")
                                        .font(.system(size: 14))
                                        .foregroundStyle(AppTheme.textTertiary)
                                        .padding(.top, 20)
                                } else {
                                    LazyVStack(spacing: 20) {
                                        ForEach(dealsByMonth, id: \.key) { group in
                                            MonthSection(
                                                monthLabel: group.month,
                                                deals: group.deals,
                                                onTap: { deal in selectedDeal = deal }
                                            )
                                        }
                                    }
                                    .padding(.horizontal, 16)
                                }
                            }
                            .padding(.vertical, 8)
                        }
                    } else {
                        // Board view - kanban columns (not inside parent ScrollView)
                        KanbanBoardView()
                            .environmentObject(pipelineVM)
                    }
                }
                .sheet(item: $selectedDeal) { deal in
                    DealDetailView(deal: deal)
                        .environmentObject(pipelineVM)
                }
            }
            .navigationTitle("Pipeline")
            .onAppear { pipelineVM.startListening() }
            .onDisappear { pipelineVM.stopListening() }
        }
    }
}

// MARK: - Month Section

struct MonthSection: View {
    let monthLabel: String
    let deals: [Deal]
    let onTap: (Deal) -> Void

    var totalValue: Double { deals.reduce(0) { $0 + $1.value } }
    var weightedValue: Double { deals.reduce(0) { $0 + $1.adjustedValue } }
    var wonDeals: [Deal] { deals.filter { $0.closedWon } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Month header card
            VStack(alignment: .leading, spacing: 6) {
                Text(monthLabel)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)

                HStack(spacing: 14) {
                    HStack(spacing: 4) {
                        Image(systemName: "number.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.orange)
                        Text("\(deals.count) deal\(deals.count == 1 ? "" : "s")")
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.textSecondary)
                    }

                    HStack(spacing: 4) {
                        Image(systemName: "chart.bar.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(AppTheme.textTertiary)
                        Text(formatCurrency(totalValue))
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.textSecondary)
                    }

                    HStack(spacing: 4) {
                        Image(systemName: "scale.3d")
                            .font(.system(size: 11))
                            .foregroundStyle(AppTheme.amber)
                        Text(formatCurrency(weightedValue))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.amber)
                    }

                    if !wonDeals.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "trophy.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(AppTheme.success)
                            Text("\(wonDeals.count) won")
                                .font(.system(size: 13))
                                .foregroundStyle(AppTheme.success)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardStyle()

            // Deal rows
            LazyVStack(spacing: 10) {
                ForEach(deals) { deal in
                    DealRowView(deal: deal)
                        .onTapGesture { onTap(deal) }
                }
            }
        }
    }
}

// MARK: - Summary Card

struct SummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(color)
                Spacer()
            }
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}

// MARK: - Bucket Chip

struct BucketChip: View {
    let label: String
    var color: Color = AppTheme.textSecondary
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? .white : AppTheme.textSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isSelected ? color : Color(hex: "F3F4F6"))
                .clipShape(Capsule())
        }
    }
}

// MARK: - Deal Row

struct DealRowView: View {
    let deal: Deal

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(deal.bucket.color)
                    .frame(width: 8, height: 8)

                Text(deal.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)

                Spacer()

                Text(formatCurrency(deal.value))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }

            HStack(spacing: 12) {
                if let contact = deal.contactName {
                    Label(contact, systemImage: "person")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                }

                Label("\(Int(deal.effectiveConfidence))%", systemImage: "gauge")
                    .font(.system(size: 12))
                    .foregroundStyle(
                        deal.effectiveConfidence >= 70 ? AppTheme.success :
                        deal.effectiveConfidence >= 40 ? AppTheme.warning : AppTheme.danger
                    )

                Spacer()

                if deal.closedWon {
                    Text("WON")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(AppTheme.success)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppTheme.success.opacity(0.1))
                        .clipShape(Capsule())
                }
            }
        }
        .padding(14)
        .cardStyle()
    }
}

// MARK: - Helpers

func formatCurrency(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencySymbol = "$"
    formatter.maximumFractionDigits = 0
    return formatter.string(from: NSNumber(value: value)) ?? "$0"
}

func formatMonthLabel(_ yyyyMM: String) -> String {
    let parts = yyyyMM.split(separator: "-")
    guard parts.count >= 2,
          let year = Int(parts[0]),
          let month = Int(parts[1]) else { return yyyyMM }
    var comps = DateComponents()
    comps.year = year
    comps.month = month
    comps.day = 1
    guard let date = Calendar.current.date(from: comps) else { return yyyyMM }
    let df = DateFormatter()
    df.dateFormat = "MMMM yyyy"
    return df.string(from: date)
}
