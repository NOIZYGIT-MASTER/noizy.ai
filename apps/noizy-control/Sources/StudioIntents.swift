import AppIntents

// MARK: - Record

struct RecordSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Record Logic Session"
    static var description = IntentDescription(
        "Triggers recording in the active Logic Pro session via ENGR_KEITH. " +
        "Performs a NOIZYNET pre-flight health check before rolling."
    )

    @Parameter(title: "Session Name", default: "NOIZY Claude Session 1")
    var sessionName: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let state = try await KeithClient.dispatch("record")
            let session = state.session ?? sessionName
            return .result(dialog: "Keith is recording in the Dreamchamber — \(session).")
        } catch KeithError.signalChainDown(let msg) {
            return .result(dialog: "Abort: \(msg)")
        }
    }
}

// MARK: - Stop

struct StopSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Logic Session"
    static var description = IntentDescription("Stops the Logic Pro transport via ENGR_KEITH.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        _ = try await KeithClient.dispatch("stop")
        return .result(dialog: "Transport stopped. Keith is standing by.")
    }
}

// MARK: - Arm

struct ArmTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Arm Track"
    static var description = IntentDescription(
        "Arms the selected track in the active Logic Pro session via ENGR_KEITH."
    )

    func perform() async throws -> some IntentResult & ProvidesDialog {
        _ = try await KeithClient.dispatch("arm")
        return .result(dialog: "Track armed. The Neumann chain is hot.")
    }
}

// MARK: - Save

struct SaveSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Save Logic Session"
    static var description = IntentDescription("Saves the active Logic Pro session via ENGR_KEITH.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        _ = try await KeithClient.dispatch("save")
        return .result(dialog: "Build saved. Session persisted on the GOD machine.")
    }
}

// MARK: - Status

struct GetSessionStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Studio Status"
    static var description = IntentDescription(
        "Reports the live ENGR_KEITH transport state and NOIZYNET signal-chain health."
    )

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await KeithClient.status()

        var parts: [String] = []
        if state.signalChainLive == true {
            parts.append("The Neumann signal chain is live")
        } else {
            parts.append("The Neumann signal chain is DOWN — check the AU Net wire")
        }
        if state.recording == true {
            parts.append("and recording")
        } else if state.armed == true {
            parts.append("and armed")
        } else {
            parts.append("and idle")
        }
        if let session = state.session {
            parts.append("in \(session)")
        }

        return .result(dialog: IntentDialog(stringLiteral: parts.joined(separator: " ") + "."))
    }
}
