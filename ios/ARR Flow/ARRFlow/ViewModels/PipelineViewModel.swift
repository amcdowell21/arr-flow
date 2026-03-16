import Foundation
import FirebaseFirestore

@MainActor
class PipelineViewModel: ObservableObject {
    @Published var deals: [Deal] = []
    @Published var events: [PipelineEvent] = []
    @Published var outbound: [OutboundEntry] = []
    @Published var isLoading = false
    @Published var selectedBucket: DealBucket? = nil
    @Published var searchText = ""
    @Published var sortBy: SortOption = .value

    private var listener: ListenerRegistration?
    private let service = FirestoreService.shared

    enum SortOption: String, CaseIterable {
        case value = "Value"
        case confidence = "Confidence"
        case name = "Name"
        case closeDate = "Close Date"
    }

    var filteredDeals: [Deal] {
        var result = deals

        if let bucket = selectedBucket {
            result = result.filter { $0.bucket == bucket }
        }

        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                ($0.contactName?.lowercased().contains(query) ?? false) ||
                ($0.state?.lowercased().contains(query) ?? false)
            }
        }

        switch sortBy {
        case .value: result.sort { $0.value > $1.value }
        case .confidence: result.sort { $0.effectiveConfidence > $1.effectiveConfidence }
        case .name: result.sort { $0.name.lowercased() < $1.name.lowercased() }
        case .closeDate: result.sort { ($0.expectedCloseMonth ?? "z") < ($1.expectedCloseMonth ?? "z") }
        }

        return result
    }

    var totalPipeline: Double {
        deals.filter { !$0.closedWon }.reduce(0) { $0 + $1.value }
    }

    var weightedPipeline: Double {
        deals.filter { !$0.closedWon }.reduce(0) { $0 + $1.adjustedValue }
    }

    var closedWon: Double {
        deals.filter { $0.closedWon }.reduce(0) { $0 + $1.value }
    }

    var bucketSummary: [(bucket: DealBucket, count: Int, value: Double)] {
        DealBucket.allCases.map { bucket in
            let bucketDeals = deals.filter { $0.bucket == bucket && !$0.closedWon }
            return (bucket, bucketDeals.count, bucketDeals.reduce(0) { $0 + $1.value })
        }
    }

    func startListening() {
        listener = service.listenToDeals { [weak self] deals in
            Task { @MainActor in
                self?.deals = deals
            }
        }
    }

    func stopListening() {
        listener?.remove()
    }

    func loadEvents() async {
        do { events = try await service.fetchEvents() } catch { print(error) }
    }

    func loadOutbound() async {
        do { outbound = try await service.fetchOutbound() } catch { print(error) }
    }

    func updateDeal(_ deal: Deal) async {
        do { try await service.updateDeal(deal) } catch { print(error) }
    }
}
