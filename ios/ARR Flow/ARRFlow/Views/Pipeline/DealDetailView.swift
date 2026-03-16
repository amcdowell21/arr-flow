import SwiftUI

struct DealDetailView: View {
    @EnvironmentObject var pipelineVM: PipelineViewModel
    @Environment(\.dismiss) var dismiss
    @State var deal: Deal
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Value header
                        VStack(spacing: 4) {
                            Text(formatCurrency(deal.value))
                                .font(.system(size: 36, weight: .bold))
                                .foregroundStyle(AppTheme.textPrimary)

                            Text("Adjusted: \(formatCurrency(deal.adjustedValue))")
                                .font(.system(size: 14))
                                .foregroundStyle(AppTheme.orange)
                        }
                        .padding(.top, 8)

                        // Details form
                        VStack(spacing: 0) {
                            FormRow(label: "Name") {
                                TextField("Deal name", text: $deal.name)
                                    .multilineTextAlignment(.trailing)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Value") {
                                TextField("0", value: $deal.value, format: .number)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Bucket") {
                                Menu {
                                    ForEach(DealBucket.allCases, id: \.self) { bucket in
                                        Button {
                                            deal.bucket = bucket
                                        } label: {
                                            HStack {
                                                Text(bucket.label)
                                                if deal.bucket == bucket { Image(systemName: "checkmark") }
                                            }
                                        }
                                    }
                                } label: {
                                    HStack(spacing: 6) {
                                        Circle().fill(deal.bucket.color).frame(width: 8, height: 8)
                                        Text(deal.bucket.label)
                                            .foregroundStyle(AppTheme.textPrimary)
                                        Image(systemName: "chevron.down")
                                            .font(.system(size: 10))
                                            .foregroundStyle(AppTheme.textTertiary)
                                    }
                                }
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Confidence") {
                                HStack(spacing: 8) {
                                    Text("\(Int(deal.effectiveConfidence))%")
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .frame(width: 40)
                                    Slider(
                                        value: Binding(
                                            get: { deal.manualConfidence ?? deal.confidence },
                                            set: { deal.manualConfidence = $0 }
                                        ),
                                        in: 0...100,
                                        step: 5
                                    )
                                    .tint(AppTheme.orange)
                                }
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Close Month") {
                                TextField("e.g. 2026-04", text: Binding(
                                    get: { deal.expectedCloseMonth ?? "" },
                                    set: { deal.expectedCloseMonth = $0.isEmpty ? nil : $0 }
                                ))
                                .multilineTextAlignment(.trailing)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Contact") {
                                TextField("Contact name", text: Binding(
                                    get: { deal.contactName ?? "" },
                                    set: { deal.contactName = $0.isEmpty ? nil : $0 }
                                ))
                                .multilineTextAlignment(.trailing)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Product") {
                                Menu {
                                    Button("UniqLearn") { deal.product = "UniqLearn" }
                                    Button("UniqPath") { deal.product = "UniqPath" }
                                    Button("None") { deal.product = nil }
                                } label: {
                                    Text(deal.product ?? "—")
                                        .foregroundStyle(AppTheme.textPrimary)
                                }
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "State") {
                                TextField("State", text: Binding(
                                    get: { deal.state ?? "" },
                                    set: { deal.state = $0.isEmpty ? nil : $0 }
                                ))
                                .multilineTextAlignment(.trailing)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Meeting Booked") {
                                Toggle("", isOn: $deal.meetingBooked)
                                    .tint(AppTheme.orange)
                            }
                            Divider().padding(.leading, 16)

                            FormRow(label: "Closed Won") {
                                Toggle("", isOn: $deal.closedWon)
                                    .tint(AppTheme.success)
                            }
                        }
                        .padding(.vertical, 4)
                        .cardStyle()
                        .padding(.horizontal, 16)

                        // Notes
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Notes")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.textSecondary)
                                .padding(.horizontal, 16)

                            TextEditor(text: Binding(
                                get: { deal.notes ?? "" },
                                set: { deal.notes = $0.isEmpty ? nil : $0 }
                            ))
                            .frame(minHeight: 100)
                            .padding(12)
                            .scrollContentBackground(.hidden)
                            .background(Color(hex: "F9FAFB"))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(AppTheme.cardBorder, lineWidth: 1)
                            )
                            .padding(.horizontal, 16)
                        }

                        // Metadata
                        if deal.hubspotId != nil || deal.source != nil {
                            VStack(alignment: .leading, spacing: 8) {
                                if let source = deal.source {
                                    HStack {
                                        Text("Source")
                                            .foregroundStyle(AppTheme.textSecondary)
                                        Spacer()
                                        Text(source)
                                            .foregroundStyle(AppTheme.textTertiary)
                                    }
                                    .font(.system(size: 13))
                                }
                                if deal.hubspotId != nil {
                                    HStack {
                                        Image(systemName: "link")
                                            .font(.system(size: 12))
                                        Text("Linked to HubSpot")
                                    }
                                    .font(.system(size: 13))
                                    .foregroundStyle(AppTheme.orange)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    .padding(.vertical, 16)
                }
            }
            .navigationTitle("Deal Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(AppTheme.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            isSaving = true
                            await pipelineVM.updateDeal(deal)
                            isSaving = false
                            dismiss()
                        }
                    } label: {
                        if isSaving {
                            ProgressView().scaleEffect(0.8)
                        } else {
                            Text("Save")
                                .fontWeight(.semibold)
                                .foregroundStyle(AppTheme.orange)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Form Row

struct FormRow<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(AppTheme.textSecondary)

            Spacer()

            content
                .font(.system(size: 15))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
