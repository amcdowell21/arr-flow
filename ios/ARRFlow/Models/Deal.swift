import Foundation

struct Deal: Identifiable, Codable {
    let id: String
    var name: String
    var value: Double
    var bucket: DealBucket
    var confidence: Double
    var manualConfidence: Double?
    var expectedCloseMonth: String?
    var contactName: String?
    var product: String?
    var state: String?
    var source: String?
    var hubspotId: String?
    var meetingBooked: Bool
    var touchCount: Int
    var lastActivityDate: Date?
    var closedWon: Bool
    var notes: String?
    var createdAt: Date?
    var updatedAt: Date?

    var effectiveConfidence: Double {
        manualConfidence ?? confidence
    }

    var adjustedValue: Double {
        value * effectiveConfidence / 100.0
    }

    var bucketLabel: String {
        bucket.label
    }
}

enum DealBucket: String, Codable, CaseIterable {
    case active
    case future_q1q2
    case future_q3q4
    case renewal
    case untagged

    var label: String {
        switch self {
        case .active: return "Active"
        case .future_q1q2: return "Future Q1/Q2"
        case .future_q3q4: return "Future Q3/Q4"
        case .renewal: return "Renewal"
        case .untagged: return "Untagged"
        }
    }

    var color: SwiftUI.Color {
        switch self {
        case .active: return AppTheme.bucketActive
        case .future_q1q2: return AppTheme.bucketFutureQ1Q2
        case .future_q3q4: return AppTheme.bucketFutureQ3Q4
        case .renewal: return AppTheme.bucketRenewal
        case .untagged: return AppTheme.bucketUntagged
        }
    }
}

import SwiftUI
