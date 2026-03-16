import Foundation

class HubSpotService {
    static let shared = HubSpotService()
    private init() {}

    struct HubSpotDeal: Identifiable {
        let id: String
        let name: String
        let amount: Double?
        let stage: String
        let pipeline: String
        let closeDate: String?
        let owner: String?
        let createdAt: String?
    }

    struct HubSpotPipeline: Identifiable {
        let id: String
        let label: String
        let stages: [HubSpotStage]
    }

    struct HubSpotStage: Identifiable {
        let id: String
        let label: String
        let displayOrder: Int
    }

    func fetchDeals() async throws -> [HubSpotDeal] {
        guard let token = APIConfig.hsToken, !token.isEmpty else {
            throw NSError(domain: "HubSpot", code: 401, userInfo: [NSLocalizedDescriptionKey: "No HubSpot token configured"])
        }

        let url = APIConfig.hubspotURL(path: "/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,pipeline,closedate,hubspot_owner_id,createdate")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else {
            return []
        }

        return results.compactMap { deal in
            guard let id = deal["id"] as? String,
                  let props = deal["properties"] as? [String: Any] else { return nil }
            return HubSpotDeal(
                id: id,
                name: props["dealname"] as? String ?? "Untitled",
                amount: Double(props["amount"] as? String ?? ""),
                stage: props["dealstage"] as? String ?? "",
                pipeline: props["pipeline"] as? String ?? "",
                closeDate: props["closedate"] as? String,
                owner: props["hubspot_owner_id"] as? String,
                createdAt: props["createdate"] as? String
            )
        }
    }

    func fetchPipelines() async throws -> [HubSpotPipeline] {
        guard let token = APIConfig.hsToken, !token.isEmpty else { return [] }

        let url = APIConfig.hubspotURL(path: "/crm/v3/pipelines/deals")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else {
            return []
        }

        return results.compactMap { pipeline in
            guard let id = pipeline["id"] as? String,
                  let label = pipeline["label"] as? String else { return nil }

            let stages = (pipeline["stages"] as? [[String: Any]])?.compactMap { stage -> HubSpotStage? in
                guard let sid = stage["id"] as? String,
                      let slabel = stage["label"] as? String else { return nil }
                return HubSpotStage(
                    id: sid,
                    label: slabel,
                    displayOrder: stage["displayOrder"] as? Int ?? 0
                )
            }.sorted(by: { $0.displayOrder < $1.displayOrder }) ?? []

            return HubSpotPipeline(id: id, label: label, stages: stages)
        }
    }

    func closedArrForYear() async throws -> Double {
        guard let token = APIConfig.hsToken, !token.isEmpty else { return 0 }

        let year = Calendar.current.component(.year, from: Date())
        let url = APIConfig.hubspotURL(path: "/crm/v3/objects/deals/search")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "filterGroups": [[
                "filters": [
                    ["propertyName": "dealstage", "operator": "EQ", "value": "closedwon"],
                    ["propertyName": "closedate", "operator": "GTE", "value": "\(year)-01-01"],
                    ["propertyName": "closedate", "operator": "LTE", "value": "\(year)-12-31"]
                ]
            ]],
            "properties": ["amount"],
            "limit": 100
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else { return 0 }

        return results.reduce(0.0) { sum, deal in
            let props = deal["properties"] as? [String: Any]
            let amount = Double(props?["amount"] as? String ?? "") ?? 0
            return sum + amount
        }
    }
}
