import Foundation

enum APIConfig {
    // Point to your Vercel deployment
    static let baseURL = "https://arrflow.co"

    static var bobChatURL: URL {
        URL(string: "\(baseURL)/api/bob")!
    }

    static var elevenSignedURL: URL {
        URL(string: "\(baseURL)/api/eleven-signed-url")!
    }

    static var ttsURL: URL {
        URL(string: "\(baseURL)/api/tts")!
    }

    static func hubspotURL(path: String) -> URL {
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path
        return URL(string: "\(baseURL)/api/hubspot?_path=\(encoded)")!
    }

    static var hsToken: String? {
        UserDefaults.standard.string(forKey: "hs_token")
    }
}
