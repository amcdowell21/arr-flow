import Foundation

struct PipelineEvent: Identifiable, Codable {
    let id: String
    var name: String
    var date: Date?
    var peopleMet: Int
    var convertedToMeeting: Int
    var value: Double?
    var notes: String?
    var createdAt: Date?
}

struct OutboundEntry: Identifiable, Codable {
    let id: String
    var weekOf: String
    var touches: Int
    var bookings: Int
    var held: Int
    var deals: Int
    var createdAt: Date?
}
