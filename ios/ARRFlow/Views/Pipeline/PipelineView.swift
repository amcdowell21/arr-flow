import SwiftUI

struct PipelineView: View {
    @EnvironmentObject var pipelineVM: PipelineViewModel
    @State private var selectedDeal: Deal?
    @State private var showDealDetail = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

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
                        .background(Color(hex: "F9FAFB"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(AppTheme.cardBorder, lineWidth: 1)
                        )
                        .padding(.horizontal, 16)

                        // Sort
                        HStack {
                            Text("\(pipelineVM.filteredDeals.count) deals")
                                .font(.system(size: 13))
                                .foregroundStyle(AppTheme.textTertiary)
                            Spacer()
                            Menu {
                                ForEach(PipelineViewModel.SortOption.allCases, id: \.self) { option in
                                    Button {
                                        pipelineVM.sortBy = option
                                    } label: {
                                        HStack {
                                            Text(option.rawValue)
                                            if pipelineVM.sortBy == option {
                                                Image(systemName: "checkmark")
                                            }
                                        }
                                    }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text("Sort: \(pipelineVM.sortBy.rawValue)")
                                        .font(.system(size: 13))
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 10))
                                }
                                .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                        .padding(.horizontal, 16)

                        // Deal list
                        LazyVStack(spacing: 10) {
                            ForEach(pipelineVM.filteredDeals) { deal in
                                DealRowView(deal: deal)
                                    .onTapGesture {
                                        selectedDeal = deal
                                        showDealDetail = true
                                    }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.vertical, 16)
                }
            }
            .navigationTitle("Pipeline")
            .sheet(isPresented: $showDealDetail) {
                if let deal = selectedDeal {
                    DealDetailView(deal: deal)
                        .environmentObject(pipelineVM)
                }
            }
            .onAppear { pipelineVM.startListening() }
            .onDisappear { pipelineVM.stopListening() }
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
                // Bucket indicator
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

                if let month = deal.expectedCloseMonth {
                    Label(month, systemImage: "calendar")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.textTertiary)
                }

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
    if value >= 1000 {
        formatter.maximumFractionDigits = 0
    }
    return formatter.string(from: NSNumber(value: value)) ?? "$0"
}
