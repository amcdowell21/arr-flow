import Foundation

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var deals: [Deal] = []
    @Published var hubspotDeals: [HubSpotService.HubSpotDeal] = []
    @Published var pipelines: [HubSpotService.HubSpotPipeline] = []
    @Published var closedArrYTD: Double = 0
    @Published var isLoading = false
    @Published var hsError: String?

    private let firestoreService = FirestoreService.shared
    private let hubspotService = HubSpotService.shared

    var totalPipelineValue: Double {
        deals.filter { !$0.closedWon }.reduce(0) { $0 + $1.value }
    }

    var weightedPipeline: Double {
        deals.filter { !$0.closedWon }.reduce(0) { $0 + $1.adjustedValue }
    }

    var closedWonValue: Double {
        deals.filter { $0.closedWon }.reduce(0) { $0 + $1.value }
    }

    var activeDealCount: Int {
        deals.filter { !$0.closedWon }.count
    }

    var monthlyProjections: [(month: String, value: Double)] {
        let openDeals = deals.filter { !$0.closedWon && $0.expectedCloseMonth != nil }
        var grouped: [String: Double] = [:]
        for deal in openDeals {
            let month = deal.expectedCloseMonth!
            grouped[month, default: 0] += deal.adjustedValue
        }
        return grouped.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    func loadAll() async {
        isLoading = true
        hsError = nil

        async let dealsResult = firestoreService.fetchDeals()
        async let hsDealsResult = loadHubSpot()

        do {
            deals = try await dealsResult
        } catch {
            print("Pipeline load error: \(error)")
        }

        await hsDealsResult
        isLoading = false
    }

    private func loadHubSpot() async {
        do {
            async let dealsTask = hubspotService.fetchDeals()
            async let pipelinesTask = hubspotService.fetchPipelines()
            async let arrTask = hubspotService.closedArrForYear()

            hubspotDeals = try await dealsTask
            pipelines = try await pipelinesTask
            closedArrYTD = try await arrTask
        } catch {
            hsError = error.localizedDescription
        }
    }
}
