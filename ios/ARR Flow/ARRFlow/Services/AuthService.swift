import Foundation
import FirebaseAuth

class AuthService {
    static let shared = AuthService()
    private init() {}

    var currentUserId: String? {
        Auth.auth().currentUser?.uid
    }

    var currentUserEmail: String? {
        Auth.auth().currentUser?.email
    }

    var isAuthenticated: Bool {
        Auth.auth().currentUser != nil
    }

    func signIn(email: String, password: String) async throws {
        try await Auth.auth().signIn(withEmail: email, password: password)
    }

    func signOut() throws {
        try Auth.auth().signOut()
    }

    func addAuthStateListener(_ handler: @escaping (Bool, String?) -> Void) -> AuthStateDidChangeListenerHandle {
        Auth.auth().addStateDidChangeListener { _, user in
            handler(user != nil, user?.uid)
        }
    }
}
