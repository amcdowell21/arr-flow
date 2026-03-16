import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var dashboardVM: DashboardViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        if dashboardVM.isLoading {
                            ProgressView()
                                .tint(AppTheme.orange)
                                .padding(.top, 40)
                        } else {
                            // Revenue overview
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Revenue Overview")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundStyle(AppTheme.textPrimary)

                                LazyVGrid(columns: [
                                    GridItem(.flexible()),
                                    GridItem(.flexible())
                                ], spacing: 12) {
                                    MetricCard(
                                        label: "Pipeline",
                                        value: formatCurrency(dashboardVM.totalPipelineValue),
                                        icon: "chart.bar.fill",
                                        color: AppTheme.orange
                                    )
                                    MetricCard(
                                        label: "Weighted",
                                        value: formatCurrency(dashboardVM.weightedPipeline),
                                        icon: "scale.3d",
                                        color: AppTheme.amber
                                    )
                                    MetricCard(
                                        label: "Closed Won",
                                        value: formatCurrency(dashboardVM.closedWonValue),
                                        icon: "trophy.fill",
                                        color: AppTheme.success
                                    )
                                    MetricCard(
                                        label: "HubSpot ARR YTD",
                                        value: formatCurrency(dashboardVM.closedArrYTD),
                                        icon: "dollarsign.circle.fill",
                                        color: AppTheme.bucketFutureQ1Q2
                                    )
                                }
                            }
                            .padding(.horizontal, 16)

                            // Monthly projections
                            if !dashboardVM.monthlyProjections.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("Monthly Projections")
                                        .font(.system(size: 18, weight: .bold))
                                        .foregroundStyle(AppTheme.textPrimary)

                                    VStack(spacing: 8) {
                                        ForEach(dashboardVM.monthlyProjections, id: \.month) { item in
                                            MonthlyBar(month: item.month, value: item.value, maxValue: dashboardVM.monthlyProjections.map(\.value).max() ?? 1)
                                        }
                                    }
                                    .padding(16)
                                    .cardStyle()
                                }
                                .padding(.horizontal, 16)
                            }

                            // HubSpot section
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("HubSpot Deals")
                                        .font(.system(size: 18, weight: .bold))
                                        .foregroundStyle(AppTheme.textPrimary)
                                    Spacer()
                                    Text("\(dashboardVM.hubspotDeals.count) deals")
                                        .font(.system(size: 13))
                                        .foregroundStyle(AppTheme.textTertiary)
                                }

                                if let error = dashboardVM.hsError {
                                    HStack(spacing: 8) {
                                        Image(systemName: "exclamationmark.triangle")
                                            .foregroundStyle(AppTheme.warning)
                                        Text(error)
                                            .font(.system(size: 13))
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(AppTheme.warning.opacity(0.08))
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                } else {
                                    // Pipeline breakdown
                                    ForEach(dashboardVM.pipelines) { pipeline in
                                        PipelineBreakdownCard(pipeline: pipeline, deals: dashboardVM.hubspotDeals)
                                    }

                                    // Recent HubSpot deals
                                    if !dashboardVM.hubspotDeals.isEmpty {
                                        VStack(spacing: 8) {
                                            ForEach(dashboardVM.hubspotDeals.prefix(10)) { deal in
                                                HubSpotDealRow(deal: deal)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    .padding(.vertical, 16)
                }
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await dashboardVM.loadAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(AppTheme.orange)
                    }
                }
            }
            .task { await dashboardVM.loadAll() }
        }
    }
}

// MARK: - Metric Card

struct MetricCard: View {
    let label: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(color)

            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}

// MARK: - Monthly Bar

struct MonthlyBar: View {
    let month: String
    let value: Double
    let maxValue: Double

    var body: some View {
        HStack(spacing: 10) {
            Text(month)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 60, alignment: .leading)

            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppTheme.orangeGradient)
                    .frame(width: max(geo.size.width * (value / maxValue), 4))
            }
            .frame(height: 20)

            Text(formatCurrency(value))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(width: 70, alignment: .trailing)
        }
    }
}

// MARK: - Pipeline Breakdown

struct PipelineBreakdownCard: View {
    let pipeline: HubSpotService.HubSpotPipeline
    let deals: [HubSpotService.HubSpotDeal]

    var pipelineDeals: [HubSpotService.HubSpotDeal] {
        deals.filter { $0.pipeline == pipeline.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(pipeline.label)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)

            ForEach(pipeline.stages) { stage in
                let stageDeals = pipelineDeals.filter { $0.stage == stage.id }
                if !stageDeals.isEmpty {
                    HStack {
                        Text(stage.label)
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.textSecondary)
                        Spacer()
                        Text("\(stageDeals.count)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.textTertiary)
                        Text(formatCurrency(stageDeals.compactMap(\.amount).reduce(0, +)))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .frame(width: 80, alignment: .trailing)
                    }
                }
            }
        }
        .padding(14)
        .cardStyle()
    }
}

// MARK: - HubSpot Deal Row

struct HubSpotDealRow: View {
    let deal: HubSpotService.HubSpotDeal

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(deal.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Text(deal.stage)
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.textTertiary)
            }
            Spacer()
            if let amount = deal.amount {
                Text(formatCurrency(amount))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
        }
        .padding(12)
        .cardStyle()
    }
}
