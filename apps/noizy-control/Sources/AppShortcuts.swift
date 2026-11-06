import AppIntents

/// Zero-friction Siri phrases.
///
/// NOTE: Apple requires every App Shortcut phrase to contain `\(.applicationName)`.
/// Phrases like "Have Keith record this take" (without the app name) will not
/// compile/register. The app name is "NOIZY Control", and we register "Keith"
/// as an alternative app name in the Info.plist (INAlternativeAppNames), which
/// lets you say "Keith" in place of "NOIZY Control" in any phrase below.
struct NOIZYShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RecordSessionIntent(),
            phrases: [
                "Start the Neumann chain with \(.applicationName)",
                "Have \(.applicationName) record this take",
                "\(.applicationName) start the build",
                "Record in the Dreamchamber with \(.applicationName)"
            ],
            shortTitle: "Record",
            systemImageName: "record.circle.fill"
        )
        AppShortcut(
            intent: StopSessionIntent(),
            phrases: [
                "Stop the take with \(.applicationName)",
                "\(.applicationName) stop recording",
                "\(.applicationName) kill the transport"
            ],
            shortTitle: "Stop",
            systemImageName: "stop.circle.fill"
        )
        AppShortcut(
            intent: ArmTrackIntent(),
            phrases: [
                "Arm the track with \(.applicationName)",
                "\(.applicationName) arm the Neumann"
            ],
            shortTitle: "Arm",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: SaveSessionIntent(),
            phrases: [
                "Save the build with \(.applicationName)",
                "\(.applicationName) save the session"
            ],
            shortTitle: "Save",
            systemImageName: "externaldrive.fill"
        )
        AppShortcut(
            intent: GetSessionStatusIntent(),
            phrases: [
                "Is the signal chain live in \(.applicationName)",
                "\(.applicationName) studio status",
                "Check the Dreamchamber with \(.applicationName)"
            ],
            shortTitle: "Status",
            systemImageName: "waveform.badge.magnifyingglass"
        )
    }
}
