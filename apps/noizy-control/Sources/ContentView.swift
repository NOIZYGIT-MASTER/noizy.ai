import SwiftUI

struct ContentView: View {
    @AppStorage("keithHost") private var keithHost = "10.90.90.10"
    @AppStorage("keithPort") private var keithPort = 7006

    @State private var state: KeithState?
    @State private var lastMessage = "Ready."
    @State private var busy = false

    var body: some View {
        VStack(spacing: 16) {
            // Header
            HStack {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.purple)
                VStack(alignment: .leading) {
                    Text("NOIZY Control").font(.title2.bold())
                    Text("ENGR_KEITH · Dreamchamber Transport")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                statusBadge
            }

            Divider()

            // Transport
            HStack(spacing: 12) {
                transportButton("Record", system: "record.circle.fill", tint: .red) {
                    await dispatch("record")
                }
                transportButton("Stop", system: "stop.circle.fill", tint: .primary) {
                    await dispatch("stop")
                }
                transportButton("Arm", system: "mic.fill", tint: .orange) {
                    await dispatch("arm")
                }
                transportButton("Save", system: "externaldrive.fill", tint: .blue) {
                    await dispatch("save")
                }
            }

            // Status line
            Text(lastMessage)
                .font(.callout.monospaced())
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))

            Spacer()

            // Connection settings
            GroupBox("ENGR_KEITH Server") {
                HStack {
                    TextField("Host", text: $keithHost)
                        .textFieldStyle(.roundedBorder)
                    TextField("Port", value: $keithPort, format: .number.grouping(.never))
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                    Button("Refresh Status") {
                        Task { await refreshStatus() }
                    }
                }
            }
        }
        .padding(20)
        .task { await refreshStatus() }
    }

    private var statusBadge: some View {
        let live = state?.signalChainLive == true
        let recording = state?.recording == true
        return Label(
            recording ? "RECORDING" : (live ? "CHAIN LIVE" : "CHAIN DOWN"),
            systemImage: recording ? "record.circle" : (live ? "checkmark.seal" : "exclamationmark.triangle")
        )
        .font(.caption.bold())
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            (recording ? Color.red : (live ? Color.green : Color.yellow)).opacity(0.2),
            in: Capsule()
        )
    }

    private func transportButton(
        _ title: String,
        system: String,
        tint: Color,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            VStack {
                Image(systemName: system).font(.title)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
        .tint(tint)
        .buttonStyle(.bordered)
        .disabled(busy)
    }

    private func dispatch(_ command: String) async {
        busy = true
        defer { busy = false }
        do {
            state = try await KeithClient.dispatch(command)
            lastMessage = "\(command.uppercased()) → \(state?.status ?? "OK")"
        } catch {
            lastMessage = "\(command.uppercased()) failed: \(error.localizedDescription)"
        }
        await refreshStatus()
    }

    private func refreshStatus() async {
        do {
            state = try await KeithClient.status()
            let live = state?.signalChainLive == true
            lastMessage = live
                ? "Signal chain LIVE · session: \(state?.session ?? "—")"
                : "Signal chain DOWN — check AU Net (port 9699)."
        } catch {
            state = nil
            lastMessage = error.localizedDescription
        }
    }
}

#Preview {
    ContentView()
}
