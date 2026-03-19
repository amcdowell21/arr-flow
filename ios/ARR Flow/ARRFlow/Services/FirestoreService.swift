import Foundation
import FirebaseFirestore

class FirestoreService {
    static let shared = FirestoreService()
    private let db = Firestore.firestore()

    private init() {}

    // MARK: - Pipeline Deals

    func fetchDeals() async throws -> [Deal] {
        let snapshot = try await db.collection("pipelineDeals").getDocuments()
        return snapshot.documents.compactMap { doc in
            parseDeal(doc)
        }
    }

    func listenToDeals(onChange: @escaping ([Deal]) -> Void) -> ListenerRegistration {
        db.collection("pipelineDeals").addSnapshotListener { snapshot, error in
            guard let snapshot, error == nil else { return }
            let deals = snapshot.documents.compactMap { self.parseDeal($0) }
            onChange(deals)
        }
    }

    func updateDeal(_ deal: Deal) async throws {
        var data: [String: Any] = [
            "name": deal.name,
            "value": deal.value,
            "bucket": deal.bucket.rawValue,
            "confidence": deal.confidence,
            "meetingBooked": deal.meetingBooked,
            "touchCount": deal.touchCount,
            "closedWon": deal.closedWon,
            "updatedAt": FieldValue.serverTimestamp()
        ]
        if let mc = deal.manualConfidence { data["manualConfidence"] = mc }
        if let ecm = deal.expectedCloseMonth { data["expectedCloseMonth"] = ecm }
        if let cn = deal.contactName { data["contactName"] = cn }
        if let p = deal.product { data["product"] = p }
        if let s = deal.state { data["state"] = s }
        if let n = deal.notes { data["notes"] = n }

        try await db.collection("pipelineDeals").document(deal.id).setData(data, merge: true)
    }

    func importHubSpotDeals(_ hsDeals: [HubSpotService.HubSpotDeal]) async throws {
        let batch = db.batch()
        for hsDeal in hsDeals {
            let ref = db.collection("pipelineDeals").document()
            var data: [String: Any] = [
                "source": "hubspot",
                "hubspotId": hsDeal.id,
                "name": hsDeal.name,
                "value": hsDeal.amount ?? 0,
                "useAlgoConfidence": true,
                "manualConfidence": 30,
                "notes": "",
                "bucket": "untagged",
                "meetingBooked": false,
                "touchCount": 0,
                "closedWon": hsDeal.stage == "closedwon",
                "hubspotStage": hsDeal.stage,
                "hubspotPipeline": hsDeal.pipeline,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ]
            if let close = hsDeal.closeDate {
                // Extract YYYY-MM from closedate
                let parts = close.prefix(7)
                if parts.count == 7 {
                    data["expectedCloseMonth"] = String(parts)
                }
            }
            batch.setData(data, forDocument: ref)
        }
        try await batch.commit()
    }

    // MARK: - Events

    func fetchEvents() async throws -> [PipelineEvent] {
        let snapshot = try await db.collection("pipelineEvents")
            .order(by: "createdAt", descending: true)
            .getDocuments()
        return snapshot.documents.compactMap { doc in
            let d = doc.data()
            return PipelineEvent(
                id: doc.documentID,
                name: d["name"] as? String ?? "",
                date: (d["date"] as? Timestamp)?.dateValue(),
                peopleMet: d["peopleMet"] as? Int ?? 0,
                convertedToMeeting: d["convertedToMeeting"] as? Int ?? 0,
                value: d["value"] as? Double,
                notes: d["notes"] as? String,
                createdAt: (d["createdAt"] as? Timestamp)?.dateValue()
            )
        }
    }

    // MARK: - Outbound

    func fetchOutbound() async throws -> [OutboundEntry] {
        let snapshot = try await db.collection("outboundActuals")
            .order(by: "createdAt", descending: true)
            .getDocuments()
        return snapshot.documents.compactMap { doc in
            let d = doc.data()
            return OutboundEntry(
                id: doc.documentID,
                weekOf: d["weekOf"] as? String ?? "",
                touches: d["touches"] as? Int ?? 0,
                bookings: d["bookings"] as? Int ?? 0,
                held: d["held"] as? Int ?? 0,
                deals: d["deals"] as? Int ?? 0,
                createdAt: (d["createdAt"] as? Timestamp)?.dateValue()
            )
        }
    }

    // MARK: - Notes

    func fetchNotes(userId: String) async throws -> UserNotes? {
        let doc = try await db.collection("userNotes").document(userId).getDocument()
        guard let d = doc.data() else { return nil }

        let blocks = (d["blocks"] as? [[String: Any]])?.map { b in
            NoteBlock(
                id: b["id"] as? String ?? UUID().uuidString,
                type: BlockType(rawValue: b["type"] as? String ?? "text") ?? .text,
                content: b["content"] as? String ?? "",
                checked: b["checked"] as? Bool
            )
        } ?? []

        // Web app stores followUps as a map { key: { date, todoText, dealName, dealId, completed } }
        let followUps: [FollowUp]? = (d["followUps"] as? [String: Any])?.compactMap { (key, value) in
            guard let f = value as? [String: Any] else { return nil }

            // Parse date: web stores as string "YYYY-MM-DD", could also be a Timestamp
            let dueDate: Date
            if let ts = f["date"] as? Timestamp {
                dueDate = ts.dateValue()
            } else if let dateStr = f["date"] as? String {
                let fmt = DateFormatter()
                fmt.dateFormat = "yyyy-MM-dd"
                fmt.timeZone = TimeZone.current
                dueDate = fmt.date(from: dateStr) ?? Date()
            } else if let ts = f["dueDate"] as? Timestamp {
                dueDate = ts.dateValue()
            } else {
                dueDate = Date()
            }

            return FollowUp(
                id: key,
                task: f["todoText"] as? String ?? f["task"] as? String ?? "",
                dealId: f["dealId"] as? String,
                dealName: f["dealName"] as? String,
                dueDate: dueDate,
                completed: f["completed"] as? Bool ?? false,
                createdAt: (f["createdAt"] as? Timestamp)?.dateValue() ?? Date()
            )
        }

        return UserNotes(
            title: d["title"] as? String ?? "Notes",
            blocks: blocks,
            followUps: followUps,
            updatedAt: (d["updatedAt"] as? Timestamp)?.dateValue()
        )
    }

    func saveNotes(userId: String, notes: UserNotes) async throws {
        let blocksData = notes.blocks.map { b -> [String: Any] in
            var dict: [String: Any] = [
                "id": b.id,
                "type": b.type.rawValue,
                "content": b.content
            ]
            if let checked = b.checked { dict["checked"] = checked }
            return dict
        }

        // Write followUps as a map keyed by id to match web app format
        var followUpsMap: [String: Any] = [:]
        if let fus = notes.followUps {
            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd"
            fmt.timeZone = TimeZone.current
            for f in fus {
                var dict: [String: Any] = [
                    "date": fmt.string(from: f.dueDate),
                    "todoText": f.task,
                    "completed": f.completed
                ]
                if let did = f.dealId { dict["dealId"] = did }
                if let dn = f.dealName { dict["dealName"] = dn }
                followUpsMap[f.id] = dict
            }
        }

        var data: [String: Any] = [
            "title": notes.title,
            "blocks": blocksData,
            "followUps": followUpsMap,
            "updatedAt": FieldValue.serverTimestamp()
        ]

        try await db.collection("userNotes").document(userId).setData(data, merge: true)
    }

    // MARK: - Conversations

    func fetchConversations(userId: String) async throws -> [Conversation] {
        let snapshot = try await db.collection("bobConversations")
            .whereField("userId", isEqualTo: userId)
            .order(by: "updatedAt", descending: true)
            .limit(to: 50)
            .getDocuments()

        return snapshot.documents.compactMap { doc in
            let d = doc.data()
            let msgs = (d["messages"] as? [[String: Any]])?.compactMap { m -> Message? in
                guard let role = m["role"] as? String,
                      let content = m["content"] as? String else { return nil }
                return Message(
                    id: m["id"] as? String ?? UUID().uuidString,
                    role: MessageRole(rawValue: role) ?? .user,
                    content: content,
                    timestamp: (m["timestamp"] as? Timestamp)?.dateValue() ?? Date()
                )
            } ?? []

            return Conversation(
                id: doc.documentID,
                title: d["title"] as? String ?? "Chat",
                messages: msgs,
                userId: userId,
                createdAt: (d["createdAt"] as? Timestamp)?.dateValue() ?? Date(),
                updatedAt: (d["updatedAt"] as? Timestamp)?.dateValue() ?? Date()
            )
        }
    }

    func deleteConversation(id: String) async throws {
        try await db.collection("bobConversations").document(id).delete()
    }

    // MARK: - Helpers

    private func parseDeal(_ doc: DocumentSnapshot) -> Deal? {
        guard let d = doc.data() else { return nil }
        return Deal(
            id: doc.documentID,
            name: d["name"] as? String ?? "",
            value: d["value"] as? Double ?? 0,
            bucket: DealBucket(rawValue: d["bucket"] as? String ?? "untagged") ?? .untagged,
            confidence: d["confidence"] as? Double ?? 30,
            manualConfidence: d["manualConfidence"] as? Double,
            expectedCloseMonth: d["expectedCloseMonth"] as? String,
            contactName: d["contactName"] as? String,
            product: d["product"] as? String,
            state: d["state"] as? String,
            source: d["source"] as? String,
            hubspotId: d["hubspotId"] as? String,
            meetingBooked: d["meetingBooked"] as? Bool ?? false,
            touchCount: d["touchCount"] as? Int ?? 0,
            lastActivityDate: (d["lastActivityDate"] as? Timestamp)?.dateValue(),
            closedWon: d["closedWon"] as? Bool ?? false,
            notes: d["notes"] as? String,
            createdAt: (d["createdAt"] as? Timestamp)?.dateValue(),
            updatedAt: (d["updatedAt"] as? Timestamp)?.dateValue()
        )
    }
}
