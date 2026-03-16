import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            AppTheme.backgroundGradient.ignoresSafeArea()
            FloatingOrbsView()

            VStack(spacing: 32) {
                Spacer()

                // Logo area
                VStack(spacing: 12) {
                    BobOrbView(isActive: false, size: 60)

                    Text("ARR Flow")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)

                    Text("Revenue intelligence, powered by Bob")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                }

                // Form
                VStack(spacing: 16) {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($focusedField, equals: .email)
                        .padding(16)
                        .background(Color(hex: "F9FAFB"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(AppTheme.cardBorder, lineWidth: 1)
                        )

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focusedField, equals: .password)
                        .padding(16)
                        .background(Color(hex: "F9FAFB"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(AppTheme.cardBorder, lineWidth: 1)
                        )
                }
                .padding(.horizontal, 32)

                // Error
                if let error = authVM.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .padding(.horizontal, 32)
                }

                // Sign in button
                Button {
                    focusedField = nil
                    Task { await authVM.signIn(email: email, password: password) }
                } label: {
                    HStack {
                        if authVM.isLoading {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Text("Sign In")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(16)
                    .background(AppTheme.orangeGradient)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(email.isEmpty || password.isEmpty || authVM.isLoading)
                .opacity(email.isEmpty || password.isEmpty ? 0.6 : 1)
                .padding(.horizontal, 32)

                Spacer()
                Spacer()
            }
        }
        .onSubmit {
            switch focusedField {
            case .email: focusedField = .password
            case .password: Task { await authVM.signIn(email: email, password: password) }
            case .none: break
            }
        }
    }
}
