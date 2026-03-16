import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var bobVM = BobViewModel()
    @StateObject private var pipelineVM = PipelineViewModel()
    @StateObject private var notesVM = NotesViewModel()
    @StateObject private var dashboardVM = DashboardViewModel()
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            BobHomeView()
                .environmentObject(bobVM)
                .tabItem {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                    Text("Bob")
                }
                .tag(0)

            PipelineView()
                .environmentObject(pipelineVM)
                .tabItem {
                    Image(systemName: "chart.bar.fill")
                    Text("Pipeline")
                }
                .tag(1)

            NotesView()
                .environmentObject(notesVM)
                .tabItem {
                    Image(systemName: "note.text")
                    Text("Notes")
                }
                .tag(2)

            DashboardView()
                .environmentObject(dashboardVM)
                .tabItem {
                    Image(systemName: "square.grid.2x2.fill")
                    Text("Dashboard")
                }
                .tag(3)

            SettingsView()
                .environmentObject(authVM)
                .tabItem {
                    Image(systemName: "gearshape.fill")
                    Text("Settings")
                }
                .tag(4)
        }
        .tint(AppTheme.orange)
        .onAppear {
            configureTabBarAppearance()
        }
    }

    private func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundColor = UIColor.systemBackground
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

// MARK: - Settings View

struct SettingsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var hsToken: String = UserDefaults.standard.string(forKey: "hs_token") ?? ""
    @State private var showingLogoutAlert = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.backgroundGradient.ignoresSafeArea()

                List {
                    Section("Account") {
                        if let email = authVM.userEmail {
                            HStack {
                                Text("Email")
                                Spacer()
                                Text(email)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Section("HubSpot Integration") {
                        SecureField("Private App Token", text: $hsToken)
                            .onChange(of: hsToken) { _, newValue in
                                UserDefaults.standard.set(newValue, forKey: "hs_token")
                            }
                        Text("Used to sync deals from HubSpot")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Section("API Configuration") {
                        HStack {
                            Text("Base URL")
                            Spacer()
                            Text(APIConfig.baseURL)
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        }
                    }

                    Section {
                        Button("Sign Out", role: .destructive) {
                            showingLogoutAlert = true
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .alert("Sign Out?", isPresented: $showingLogoutAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Sign Out", role: .destructive) {
                    authVM.signOut()
                }
            }
        }
    }
}
