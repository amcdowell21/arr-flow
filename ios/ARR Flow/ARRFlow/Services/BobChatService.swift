import Foundation

class BobChatService {
    static let shared = BobChatService()
    private init() {}

    /// Streams a Bob chat response via SSE. Calls handlers for content deltas, tool events, and completion.
    func sendMessage(
        messages: [[String: String]],
        userId: String,
        conversationId: String?,
        onDelta: @escaping (String) -> Void,
        onTool: @escaping (ToolCall) -> Void,
        onConversationId: @escaping (String) -> Void,
        onDone: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) -> URLSessionDataTask {
        var request = URLRequest(url: APIConfig.bobChatURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "messages": messages,
            "userId": userId,
            "timezone": TimeZone.current.identifier
        ]
        if let cid = conversationId { body["conversationId"] = cid }
        if let token = APIConfig.hsToken { body["hsToken"] = token }

        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let delegate = SSEDelegate(
            onDelta: onDelta,
            onTool: onTool,
            onConversationId: onConversationId,
            onDone: onDone,
            onError: onError
        )

        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: .main)
        let task = session.dataTask(with: request)
        task.resume()
        return task
    }
}

// MARK: - SSE Delegate

private class SSEDelegate: NSObject, URLSessionDataDelegate {
    let onDelta: (String) -> Void
    let onTool: (ToolCall) -> Void
    let onConversationId: (String) -> Void
    let onDone: () -> Void
    let onError: (Error) -> Void

    private var buffer = ""

    init(
        onDelta: @escaping (String) -> Void,
        onTool: @escaping (ToolCall) -> Void,
        onConversationId: @escaping (String) -> Void,
        onDone: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        self.onDelta = onDelta
        self.onTool = onTool
        self.onConversationId = onConversationId
        self.onDone = onDone
        self.onError = onError
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            let msg = "Server error (\(http.statusCode)) — check Vercel logs"
            onError(NSError(domain: "BobChat", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: msg]))
            completionHandler(.cancel)
        } else {
            completionHandler(.allow)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text

        // Process complete SSE lines
        while let newlineRange = buffer.range(of: "\n\n") {
            let chunk = String(buffer[buffer.startIndex..<newlineRange.lowerBound])
            buffer = String(buffer[newlineRange.upperBound...])
            processSSEChunk(chunk)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error, (error as NSError).code != NSURLErrorCancelled {
            onError(error)
        } else if error == nil {
            // Process remaining buffer
            if !buffer.isEmpty {
                processSSEChunk(buffer)
                buffer = ""
            }
            onDone()
        }
    }

    private func processSSEChunk(_ chunk: String) {
        var eventType = ""
        var eventData = ""

        for line in chunk.split(separator: "\n", omittingEmptySubsequences: false) {
            let lineStr = String(line)
            if lineStr.hasPrefix("event: ") {
                eventType = String(lineStr.dropFirst(7))
            } else if lineStr.hasPrefix("data: ") {
                eventData = String(lineStr.dropFirst(6))
            }
        }

        switch eventType {
        case "delta":
            if let data = eventData.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let text = json["text"] as? String {
                onDelta(text)
            }

        case "tool":
            if let data = eventData.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let name = json["name"] as? String {
                let status = json["status"] as? String ?? "running"
                let toolCall = ToolCall(
                    id: json["id"] as? String ?? UUID().uuidString,
                    name: name,
                    status: ToolCall.ToolStatus(rawValue: status) ?? .running
                )
                onTool(toolCall)
            }

        case "conversation":
            if let data = eventData.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = json["id"] as? String {
                onConversationId(id)
            }

        case "done":
            onDone()

        case "error":
            onError(NSError(domain: "BobChat", code: -1, userInfo: [NSLocalizedDescriptionKey: eventData]))

        default:
            // For lines without event prefix, treat as delta
            if !chunk.isEmpty && eventType.isEmpty {
                // May be raw data lines
                for line in chunk.split(separator: "\n") {
                    let l = String(line)
                    if l.hasPrefix("data: ") {
                        let raw = String(l.dropFirst(6))
                        if let d = raw.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                           let text = json["text"] as? String {
                            onDelta(text)
                        }
                    }
                }
            }
        }
    }
}
