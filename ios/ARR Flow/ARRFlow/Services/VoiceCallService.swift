import Foundation
import AVFoundation

/// Manages ElevenLabs voice call sessions via WebSocket.
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

    private var wsSession: URLSession?
    private var webSocket: URLSessionWebSocketTask?
    private var audioEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var hwSampleRate: Double = 44100
    private var callTimer: Timer?
    private var callStartTime: Date?

    // Gate object written on MainActor, read from audio tap thread.
    // One-way transition (false → true, never reset during a call).
    // Simple class ref is safe for this pattern on ARM.
    private final class SendGate { var open = false }
    private var sendGate = SendGate()

    private let elevenLabsFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000, channels: 1, interleaved: true
    )!

    struct TranscriptEntry: Identifiable {
        let id = UUID()
        let role: String
        let text: String
        let timestamp: Date
    }

    override private init() { super.init() }

    func startCall(userId: String) async throws {
        guard !isCallActive else { return }
        isConnecting = true

        let granted = await withCheckedContinuation { cont in
            AVAudioSession.sharedInstance().requestRecordPermission { cont.resume(returning: $0) }
        }
        guard granted else {
            isConnecting = false
            throw NSError(domain: "VoiceCall", code: -3,
                          userInfo: [NSLocalizedDescriptionKey: "Microphone access denied"])
        }

        let (data, _) = try await URLSession.shared.data(for: URLRequest(url: APIConfig.elevenSignedURL))
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let signedUrl = json["signed_url"] as? String,
              let wsURL = URL(string: signedUrl) else {
            isConnecting = false
            throw NSError(domain: "VoiceCall", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Failed to get signed URL"])
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .voiceChat,
                                     options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession.setActive(true)
        hwSampleRate = audioSession.sampleRate
        print("[VoiceCall] Hardware sample rate: \(hwSampleRate) Hz")

        // Fresh gate for this call
        sendGate = SendGate()

        // Create WebSocket FIRST so setupAudio() can capture a valid reference
        // Store the session so it isn't deallocated (which would cancel the WS task)
        let session = URLSession(configuration: .default)
        wsSession = session
        webSocket = session.webSocketTask(with: wsURL)
        webSocket?.resume()

        let initMsg = "{\"type\":\"conversation_initiation_client_data\"}"
        webSocket?.send(.string(initMsg)) { _ in }

        // Build full audio graph (tap included) BEFORE engine.start()
        try setupAudio()

        receiveMessages()

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
        wsSession?.invalidateAndCancel()
        wsSession = nil
        sendGate.open = false
        audioEngine?.inputNode.removeTap(onBus: 0)
        playerNode?.stop()
        audioEngine?.stop()
        audioEngine = nil
        playerNode = nil
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

    // MARK: - Audio Setup
    // Full graph built before engine.start() so hardware input is properly activated.

    private func setupAudio() throws {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        audioEngine = engine
        playerNode = player

        engine.attach(player)

        // Access inputNode before any connections so the engine resolves its format
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        print("[VoiceCall] Input format: \(inputFormat)")

        guard inputFormat.sampleRate > 0 else {
            throw NSError(domain: "VoiceCall", code: -4,
                          userInfo: [NSLocalizedDescriptionKey: "Input format has zero sample rate"])
        }

        let hwFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: hwSampleRate, channels: 1, interleaved: false)!
        engine.connect(player, to: engine.mainMixerNode, format: hwFormat)

        guard let converter = AVAudioConverter(from: inputFormat, to: elevenLabsFormat) else {
            throw NSError(domain: "VoiceCall", code: -5,
                          userInfo: [NSLocalizedDescriptionKey: "Failed to create mic converter"])
        }

        let gate = sendGate           // captured on MainActor
        let capturedWS = webSocket    // captured on MainActor — non-nil since WS created above
        let elevenFmt = elevenLabsFormat
        var chunksSent = 0

        // Install tap now, before engine.start(), so hardware input is activated.
        // Sends are gated behind `gate.open` — set true on receiving conversation_initiation_metadata.
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            // Mic level (always, regardless of gate)
            if let ch = buffer.floatChannelData?[0] {
                let n = Int(buffer.frameLength)
                var sum: Float = 0
                for i in 0..<n { sum += abs(ch[i]) }
                let avg = n > 0 ? sum / Float(n) : 0
                Task { @MainActor in self?.micLevel = min(avg * 10, 1.0) }
            }

            guard gate.open else { return }
            let ws = capturedWS

            // Convert to 16kHz Int16 PCM
            let ratio = 16000.0 / inputFormat.sampleRate
            let outCap = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
            guard let converted = AVAudioPCMBuffer(pcmFormat: elevenFmt, frameCapacity: outCap)
            else { return }

            var convError: NSError?
            var hasProvided = false
            let status = converter.convert(to: converted, error: &convError) { _, outStatus in
                if hasProvided { outStatus.pointee = .noDataNow; return nil }
                hasProvided = true
                outStatus.pointee = .haveData
                return buffer
            }
            if let convError {
                print("[VoiceCall] Converter error: \(convError)")
                return
            }
            guard status == .haveData,
                  converted.frameLength > 0,
                  let samples = converted.int16ChannelData else { return }

            let byteCount = Int(converted.frameLength) * MemoryLayout<Int16>.size
            let b64 = Data(bytes: samples[0], count: byteCount).base64EncodedString()
            chunksSent += 1
            if chunksSent <= 3 || chunksSent % 50 == 0 {
                print("[VoiceCall] Sending audio chunk #\(chunksSent) (\(byteCount) bytes)")
            }
            ws?.send(.string("{\"user_audio_chunk\":\"\(b64)\"}")) { error in
                if let error { print("[VoiceCall] Send error: \(error)") }
            }
        }

        player.play()
        try engine.start()
        print("[VoiceCall] Audio engine started, awaiting session confirmation to open mic gate")
    }

    // MARK: - WebSocket Receive Loop (fully on MainActor)

    private func receiveMessages() {
        webSocket?.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch result {
                case .success(let message):
                    let text: String?
                    switch message {
                    case .string(let s): text = s
                    case .data(let d):   text = String(data: d, encoding: .utf8)
                    @unknown default:    text = nil
                    }
                    if let text { self.handleMessage(text) }
                    self.receiveMessages()
                case .failure(let error):
                    print("[VoiceCall] WebSocket closed: \(error)")
                    self.endCall()
                }
            }
        }
    }

    // MARK: - Message Handling (always on MainActor)

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        print("[VoiceCall] ← \(type)")

        switch type {
        case "conversation_initiation_metadata":
            // Open the gate — tap will now start sending mic audio to ElevenLabs
            sendGate.open = true
            print("[VoiceCall] Mic gate open, sending audio")

        case "audio":
            if let event = json["audio_event"] as? [String: Any],
               let b64 = event["audio_base_64"] as? String,
               let pcmData = Data(base64Encoded: b64) {
                playPCMChunk(pcmData)
            } else {
                print("[VoiceCall] Audio event — unexpected structure: \(json.keys.joined(separator: ", "))")
            }
            isSpeaking = true
            isListening = false

        case "agent_response":
            if let event = json["agent_response_event"] as? [String: Any],
               let content = event["agent_response"] as? String, !content.isEmpty {
                transcript.append(TranscriptEntry(role: "agent", text: content, timestamp: Date()))
            }
            isSpeaking = false
            isListening = true

        case "user_transcript":
            if let event = json["user_transcription_event"] as? [String: Any],
               let content = event["user_transcript"] as? String, !content.isEmpty {
                transcript.append(TranscriptEntry(role: "user", text: content, timestamp: Date()))
            }
            isSpeaking = false
            isListening = true

        case "interruption":
            isSpeaking = false
            isListening = true

        case "ping":
            if let event = json["ping_event"] as? [String: Any],
               let eventId = event["event_id"] {
                webSocket?.send(.string("{\"type\":\"pong\",\"event_id\":\(eventId)}")) { error in
                    if let error { print("[VoiceCall] Pong send error: \(error)") }
                }
            } else {
                print("[VoiceCall] ⚠️ Could not parse ping event: \(text.prefix(200))")
            }

        case "error":
            print("[VoiceCall] ElevenLabs error: \(text)")
            endCall()

        case "session_end":
            print("[VoiceCall] Session ended by server: \(text.prefix(500))")
            endCall()

        default:
            print("[VoiceCall] Unhandled '\(type)': \(text.prefix(300))")
        }
    }

    // MARK: - Playback

    private func playPCMChunk(_ data: Data) {
        guard let player = playerNode else { return }
        let frameCount = AVAudioFrameCount(data.count / MemoryLayout<Int16>.size)
        guard frameCount > 0 else { return }

        let hwFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: hwSampleRate, channels: 1, interleaved: false)!

        if hwSampleRate == 16000 {
            guard let buf = AVAudioPCMBuffer(pcmFormat: hwFormat, frameCapacity: frameCount),
                  let floatSamples = buf.floatChannelData else { return }
            buf.frameLength = frameCount
            data.withUnsafeBytes { raw in
                guard let src = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
                for i in 0..<Int(frameCount) {
                    floatSamples[0][i] = Float(src[i]) / Float(Int16.max)
                }
            }
            player.scheduleBuffer(buf)
        } else {
            guard let conv = AVAudioConverter(from: elevenLabsFormat, to: hwFormat),
                  let srcBuf = AVAudioPCMBuffer(pcmFormat: elevenLabsFormat, frameCapacity: frameCount),
                  let srcSamples = srcBuf.int16ChannelData else { return }
            srcBuf.frameLength = frameCount
            data.withUnsafeBytes { raw in
                guard let src = raw.baseAddress else { return }
                memcpy(srcSamples[0], src, data.count)
            }
            let outCap = AVAudioFrameCount(Double(frameCount) * hwSampleRate / 16000) + 1
            guard let outBuf = AVAudioPCMBuffer(pcmFormat: hwFormat, frameCapacity: outCap) else { return }
            var providerCalled = false
            conv.convert(to: outBuf, error: nil) { _, outStatus in
                if providerCalled { outStatus.pointee = .noDataNow; return nil }
                providerCalled = true
                outStatus.pointee = .haveData
                return srcBuf
            }
            guard outBuf.frameLength > 0 else { return }
            player.scheduleBuffer(outBuf)
        }

        if !player.isPlaying { player.play() }
    }
}
