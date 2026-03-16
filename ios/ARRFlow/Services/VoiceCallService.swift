import Foundation
import AVFoundation

/// Manages ElevenLabs voice call sessions via WebSocket.
/// Uses the signed URL endpoint to authenticate, then communicates
/// over WebSocket with the ElevenLabs Conversational AI agent.
@MainActor
class VoiceCallService: NSObject, ObservableObject {
    static let shared = VoiceCallService()

    @Published var isCallActive = false
    @Published var isConnecting = false
    @Published var isSpeaking = false
    @Published var isListening = false
    @Published var callDuration: TimeInterval = 0
    @Published var transcript: [TranscriptEntry] = []
    @Published var micLevel: Float = 0

    private var webSocket: URLSessionWebSocketTask?
    private var audioEngine = AVAudioEngine()
    private var callTimer: Timer?
    private var callStartTime: Date?

    struct TranscriptEntry: Identifiable {
        let id = UUID()
        let role: String // "user" or "agent"
        let text: String
        let timestamp: Date
    }

    override private init() {
        super.init()
    }

    func startCall(userId: String) async throws {
        guard !isCallActive else { return }
        isConnecting = true

        // 1. Get signed WebSocket URL
        var request = URLRequest(url: APIConfig.elevenSignedURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId])

        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let signedUrl = json["signedUrl"] as? String,
              let wsURL = URL(string: signedUrl) else {
            isConnecting = false
            throw NSError(domain: "VoiceCall", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to get signed URL"])
        }

        // 2. Setup audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession.setActive(true)

        // 3. Connect WebSocket
        let session = URLSession(configuration: .default)
        webSocket = session.webSocketTask(with: wsURL)
        webSocket?.resume()

        // 4. Start audio capture
        startAudioCapture()

        // 5. Listen for messages
        receiveMessages()

        // 6. Update state
        isConnecting = false
        isCallActive = true
        isListening = true
        callStartTime = Date()
        transcript = []

        callTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let start = self.callStartTime else { return }
                self.callDuration = Date().timeIntervalSince(start)
            }
        }
    }

    func endCall() {
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        callTimer?.invalidate()
        callTimer = nil

        try? AVAudioSession.sharedInstance().setActive(false)

        isCallActive = false
        isConnecting = false
        isSpeaking = false
        isListening = false
        callDuration = 0
        callStartTime = nil
    }

    var formattedDuration: String {
        let mins = Int(callDuration) / 60
        let secs = Int(callDuration) % 60
        return String(format: "%d:%02d", mins, secs)
    }

    // MARK: - Audio Capture

    private func startAudioCapture() {
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            // Calculate mic level
            let channelData = buffer.floatChannelData?[0]
            let frames = buffer.frameLength
            var sum: Float = 0
            if let channelData {
                for i in 0..<Int(frames) {
                    sum += abs(channelData[i])
                }
            }
            let avg = sum / Float(frames)

            Task { @MainActor in
                self?.micLevel = min(avg * 10, 1.0)
            }

            // Send audio data over WebSocket
            let data = Data(bytes: buffer.floatChannelData![0], count: Int(buffer.frameLength) * MemoryLayout<Float>.size)
            self?.sendAudioData(data)
        }

        do {
            try audioEngine.start()
        } catch {
            print("Audio engine failed to start: \(error)")
        }
    }

    private func sendAudioData(_ data: Data) {
        webSocket?.send(.data(data)) { error in
            if let error {
                print("WebSocket send error: \(error)")
            }
        }
    }

    // MARK: - WebSocket Messages

    private func receiveMessages() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleMessage(text)
                case .data(let data):
                    // Audio playback data from agent
                    self?.handleAudioData(data)
                @unknown default:
                    break
                }
                // Continue listening
                self?.receiveMessages()

            case .failure(let error):
                print("WebSocket receive error: \(error)")
                Task { @MainActor in
                    self?.endCall()
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        Task { @MainActor in
            switch type {
            case "transcript":
                if let role = json["role"] as? String,
                   let content = json["text"] as? String {
                    transcript.append(TranscriptEntry(role: role, text: content, timestamp: Date()))
                }
            case "agent_speaking":
                isSpeaking = true
                isListening = false
            case "agent_listening":
                isSpeaking = false
                isListening = true
            case "session_end":
                endCall()
            default:
                break
            }
        }
    }

    private func handleAudioData(_ data: Data) {
        // In production, decode and play audio through AVAudioPlayer
        // ElevenLabs sends PCM audio data that needs to be played back
    }
}
