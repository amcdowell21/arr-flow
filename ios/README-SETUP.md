# ARR Flow iOS App - Setup Guide

## Create Xcode Project

1. Open Xcode → **File → New → Project**
2. Choose **iOS → App**
3. Settings:
   - Product Name: `ARRFlow`
   - Team: Your team
   - Organization Identifier: `co.uniqlearn` (or your own)
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **None**
4. Save it into the `ios/` folder
5. **Delete** the auto-generated `ContentView.swift` and `ARRFlowApp.swift`
6. **Drag all files** from `ios/ARRFlow/` into the Xcode project navigator

## Add Firebase SDK

1. In Xcode: **File → Add Package Dependencies**
2. Enter: `https://github.com/firebase/firebase-ios-sdk`
3. Select version: **11.0.0** or latest
4. Add these libraries:
   - `FirebaseAuth`
   - `FirebaseFirestore`

## Configure Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Open your existing arr-flow project
3. Add an **iOS app** if not already added
4. Download `GoogleService-Info.plist`
5. Drag it into the Xcode project root (make sure "Copy items if needed" is checked)

## Update API Base URL

In `Theme/APIConfig.swift`, update `baseURL` to match your Vercel deployment:
```swift
static let baseURL = "https://your-deployment.vercel.app"
```

## Build & Run

1. Select an iPhone simulator or device
2. Build and run (Cmd+R)
3. Sign in with your existing Firebase Auth credentials
4. Set your HubSpot token in Settings tab

## Architecture

```
ARRFlow/
├── ARRFlowApp.swift          # Entry point, Firebase init
├── ContentView.swift          # Tab navigation + Settings
├── Theme/
│   ├── AppTheme.swift         # Colors, gradients, modifiers
│   ├── FloatingOrbsView.swift # Animated background orbs + Bob orb
│   └── APIConfig.swift        # API endpoints
├── Models/
│   ├── Message.swift          # Chat messages + tool calls
│   ├── Conversation.swift     # Chat history
│   ├── Deal.swift             # Pipeline deals + buckets
│   ├── NoteBlock.swift        # Notes blocks + follow-ups
│   └── PipelineEvent.swift    # Events + outbound entries
├── Services/
│   ├── AuthService.swift      # Firebase Auth wrapper
│   ├── FirestoreService.swift # Firestore CRUD
│   ├── BobChatService.swift   # SSE streaming to /api/bob
│   ├── VoiceCallService.swift # ElevenLabs WebSocket voice
│   └── HubSpotService.swift   # HubSpot API via proxy
├── ViewModels/
│   ├── AuthViewModel.swift
│   ├── BobViewModel.swift
│   ├── PipelineViewModel.swift
│   ├── NotesViewModel.swift
│   └── DashboardViewModel.swift
└── Views/
    ├── Auth/LoginView.swift
    ├── Bob/
    │   ├── BobHomeView.swift         # Idle/chat/call router
    │   ├── BobChatView.swift         # Chat messages + input
    │   ├── BobCallView.swift         # Voice call UI
    │   └── ConversationListView.swift # History
    ├── Pipeline/
    │   ├── PipelineView.swift        # Deal list + filters
    │   └── DealDetailView.swift      # Deal editor
    ├── Notes/NotesView.swift         # Block editor + follow-ups
    └── Dashboard/DashboardView.swift # Revenue + HubSpot summary
```
