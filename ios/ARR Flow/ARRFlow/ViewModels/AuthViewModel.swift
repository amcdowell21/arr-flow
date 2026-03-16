import Foundation
import FirebaseAuth

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var userEmail: String?
    @Published var userId: String?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var authHandle: AuthStateDidChangeListenerHandle?

    init() {
        authHandle = AuthService.shared.addAuthStateListener { [weak self] isAuth, uid in
            Task { @MainActor in
                self?.isAuthenticated = isAuth
                self?.userId = uid
                self?.userEmail = Auth.auth().currentUser?.email
            }
        }
    }

    func signIn(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        do {
            try await AuthService.shared.signIn(email: email, password: password)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func signOut() {
        try? AuthService.shared.signOut()
    }

    deinit {
        if let handle = authHandle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }
}
