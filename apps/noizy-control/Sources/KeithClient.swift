import Foundation

/// Real-time state reported by engr_keith_server.js (v3.1) on the GOD machine.
struct KeithState: Decodable {
    let agent: String?
    let status: String?
    let session: String?
    let recording: Bool?
    let armed: Bool?
    let signalChainLive: Bool?
    // Error envelope (returned when e.g. the signal chain is down)
    let error: String?
    let msg: String?
}

enum KeithError: LocalizedError {
    case signalChainDown(String)
    case badResponse(Int)
    case unreachable(String)

    var errorDescription: String? {
        switch self {
        case .signalChainDown(let msg):
            return msg
        case .badResponse(let code):
            return "ENGR_KEITH returned HTTP \(code)."
        case .unreachable(let host):
            return "Could not reach ENGR_KEITH at \(host). Is the server running on the GOD machine?"
        }
    }
}

/// Thin async HTTP client for the ENGR_KEITH transport server (port 7006).
struct KeithClient {
    /// Host/port are overridable from the NOIZY Control UI (stored in UserDefaults)
    /// so the app works whether you're on NOIZYNET (10.90.90.10) or localhost.
    static var host: String {
        UserDefaults.standard.string(forKey: "keithHost") ?? "10.90.90.10"
    }

    static var port: Int {
        let p = UserDefaults.standard.integer(forKey: "keithPort")
        return p == 0 ? 7006 : p
    }

    static var baseURL: URL {
        URL(string: "http://\(host):\(port)")!
    }

    private static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        return URLSession(configuration: config)
    }

    /// POST a transport command ("record", "stop", "arm", "save") to /dispatch.
    static func dispatch(_ command: String) async throws -> KeithState {
        var request = URLRequest(url: baseURL.appendingPathComponent("dispatch"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["command": command])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw KeithError.unreachable("\(host):\(port)")
        }

        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw KeithError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }

        let state = try JSONDecoder().decode(KeithState.self, from: data)
        if let error = state.error {
            throw KeithError.signalChainDown(state.msg ?? error)
        }
        return state
    }

    /// GET /status — includes a live pre-flight poll of the NOIZYNET daemon (port 9699).
    static func status() async throws -> KeithState {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(from: baseURL.appendingPathComponent("status"))
        } catch {
            throw KeithError.unreachable("\(host):\(port)")
        }

        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw KeithError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(KeithState.self, from: data)
    }
}
