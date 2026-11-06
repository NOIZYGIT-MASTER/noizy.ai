# NOIZY Control — Apple Intelligence App Intents for ENGR_KEITH

Siri-native transport control for the Dreamchamber. Wraps the existing
`noizy_logic_control.applescript` automation in a Swift **App Intents** app so
Apple Intelligence can drive Logic Pro on the GOD machine (M2 Ultra) by voice.

```
Siri / Apple Intelligence
        │  App Intent (RecordSessionIntent, …)
        ▼
NOIZY Control.app  (this project, macOS 14+)
        │  HTTP POST /dispatch        {"command":"record"}
        ▼
engr_keith_server.js  :7006  (server/engr_keith_server.js, v3.1)
        │  pre-flight GET /health → noizynet_daemon :9699   ← zero-failure gate
        │  osascript noizy_logic_control.applescript <cmd>
        ▼
Logic Pro  (Neumann chain / Dreamchamber)
```

## Intents

| Command | App Intent              | Siri result |
|---------|-------------------------|-------------|
| Record  | `RecordSessionIntent`   | Health-gated record; aborts with a spoken warning if the AU Net wire is down |
| Stop    | `StopSessionIntent`     | Immediate transport stop |
| Arm     | `ArmTrackIntent`        | Arms the selected track |
| Save    | `SaveSessionIntent`     | "Keith, save the build" |
| Status  | `GetSessionStatusIntent`| "The Neumann signal chain is live and recording in NOIZY Claude Session 1." |

## Build (on the GOD machine)

```bash
brew install xcodegen
cd apps/noizy-control
xcodegen generate
open NOIZYControl.xcodeproj
```

Build & run once (⌘R). Launching the app registers the App Shortcuts with
Siri/Spotlight automatically — no Shortcuts-app setup needed.

Requirements: macOS 14+ (Sonoma) for the AppShortcuts API surface used here;
Apple Intelligence features require macOS 15.1+ on Apple silicon.

## Siri phrases

Apple requires every App Shortcut phrase to include the app name, so the raw
phrase "Have Keith record this take" is not registrable as-is. Two mitigations
are built in:

1. `INAlternativeAppNames` in the Info.plist registers **"Keith"** and
   **"NOIZY"** as alternative app names, so "Have Keith record this take"
   works because "Keith" *is* the app name as far as Siri is concerned.
2. All phrases in `Sources/AppShortcuts.swift` use `\(.applicationName)`.

Working examples:

- "Hey Siri, **start the Neumann chain with Keith**"
- "Hey Siri, **have Keith record this take**"
- "Hey Siri, **Keith stop recording**"
- "Hey Siri, **save the build with Keith**"
- "Hey Siri, **is the signal chain live in Keith**"

## Server deployment (ENGR_KEITH v3.1)

```bash
# On the GOD machine
cp server/engr_keith_server.js ~/Desktop/engr_keith_server.js   # or your service dir
pkill -f engr_keith_server.js || true
node ~/Desktop/engr_keith_server.js &
curl -s localhost:7006/status | jq   # verify signalChainLive boolean appears
```

v3.1 changes vs v3.0:

- `GET /status` — granular state for Siri (recording / armed / signalChainLive / session)
- `POST /dispatch` — JSON command endpoint used by the App Intents
- Pre-flight NOIZYNET gate: `record` is refused with `SIGNAL_CHAIN_DOWN`
  unless `noizynet_daemon` (:9699) reports the chain live
- New `arm` command; `execFileSync` instead of shell interpolation (no quoting
  injection via command strings)

## Configuration

The app targets `10.90.90.10:7006` (NOIZYNET → GOD) by default. Host and port
are editable live in the NOIZY Control window (persisted via `UserDefaults`),
so the same build works on-box (`127.0.0.1`) or from another NOIZYNET node.

## Honest limitations

- **On-screen awareness**: "Record *this*" resolution to the frontmost Logic
  window is mediated by Apple Intelligence and is not guaranteed by the App
  Intents API alone; the reliable contract is the explicit phrases above.
  The AppleScript layer already targets the active Logic session, which gives
  the same practical effect.
- This code cannot be compiled in a Linux CI sandbox (AppIntents/SwiftUI are
  Apple-platform frameworks). First build must happen in Xcode on the Mac
  Studio; the sources are written against macOS 14 SDK APIs.
- The AppleScript must accept an `arm` verb for `ArmTrackIntent` to do real
  work — add a handler to `noizy_logic_control.applescript` if it only has
  record/stop/save/status today.
