# NOIZY.OSX — FOSS foundation v0.1

A local-first **application layer for macOS and Linux**, not a bootable macOS
distribution. Nothing installs to MICHAEL or MICKY-P, changes partitions,
registers an MCP client, or modifies the operating system. Existing recovery
code, checkpoints and artifacts are not read or changed.

## Install and verify

Use Node 24+ and the repository's Node ecosystem. From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run format:check
npm run inventory
```

No global packages are required. The official `@modelcontextprotocol/sdk` is
pinned to 1.32.2 (MIT); Zod 4.6.7 provides shared strict schemas. Prettier is a local
development dependency. `check` runs Node syntax checks; this JavaScript app
has no compilation step. `inventory` prints structured JSON and runs only
fixed version probes for available catalog executables.

Initial verification used the previously available SDK 1.29.0, but `npm audit`
reported published advisories in that version and Zod 3. Only this app's local
dependencies were updated to patched releases; existing applications were not
changed.

## JavaScript SDK

```js
import {
  listCapabilities,
  discoverExecutables,
  probeVersion,
  recommendTools,
} from "./src/sdk.js";

const catalog = listCapabilities({ category: "disk-rescue" });
const inventory = await discoverExecutables();
const version = await probeVersion({ toolId: "ddrescue" });
const suggestions = await recommendTools({ category: "disk-rescue" });
```

`createSdk()` creates an isolated SDK instance. Its optional `searchPath`,
`platform`, `timeoutMs`, `maxOutputBytes` and `maxConcurrent` settings are
**trusted in-process configuration**, not REST or MCP inputs. Defaults are
the process PATH/platform, 2 seconds, 8,192 combined stdout/stderr bytes,
and two simultaneous probes. Hard ceilings are 5 seconds, 32,768 bytes and
four probes; additional probes return `busy` rather than queue indefinitely.

Results distinguish `available`, `unavailable`, `unsupported` and `external`
discovery states. Probe states additionally include `ok`, `error`, `timeout`,
`output-limit` and `busy`. Only `ok` confirms a successful version command.
Discovery proves only that an executable file exists and is executable; it
does not prove authenticity, tool health, virtualization support, attached
devices, license compliance, or operational readiness. Recommendations report
that evidence rather than pretending to perform operations.

## Authenticated loopback REST

Supply `NOIZY_OSX_TOKEN` in the launch environment. There is no default token,
token file, token logging, or token returned by the server. It must be 32–512
printable non-space ASCII characters; use a high-entropy random value, not
a password. For a temporary shell session:

```sh
export NOIZY_OSX_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run rest
```

The listener is fixed to **127.0.0.1**; `NOIZY_OSX_PORT` defaults to 4318.
Every request requires `Authorization: Bearer <environment token>`.
Use the literal host `127.0.0.1:<port>`, not `localhost`. If Origin is present,
it must equal `http://127.0.0.1:<port>` exactly. Cross-origin and `null` origins
are rejected; no CORS preflight or wildcard access is enabled.

Read-only GET endpoints:

- `/v1/capabilities` — optional `category`
- `/v1/discover` — optional `toolId`
- `/v1/probe` — required `toolId`
- `/v1/recommend` — required `category`

Unknown or duplicate parameters and request bodies are rejected. Non-GET
methods receive 405 after authentication; unknown endpoints receive 404.
Authentication failures receive 401, Host/Origin failures 403, schema failures 400. Responses are JSON with `Cache-Control: no-store`.

Example request from a second process inheriting the token, without placing
the credential in command-line arguments:

```sh
node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:4318/v1/discover", {
    headers: { Authorization: `Bearer ${process.env.NOIZY_OSX_TOKEN}` }
  });
  console.log(JSON.stringify(await response.json()));
'
```

Do not reverse-proxy this service, bind a custom imported HTTP server to an
external address, or share its bearer token. Loopback authentication is not
a substitute for the host OS's user and process isolation.

## Stdio MCP

Launch `node src/mcp.js` directly (not `npm run mcp`, whose npm banner can
pollute stdio for some clients). Stdout is reserved for MCP protocol messages.
The official SDK serves:

- `noizy_capabilities`
- `noizy_discover`
- `noizy_probe`
- `noizy_recommend`

Schemas match REST/SDK and reject unknown fields. Tools are annotated
`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
`openWorldHint: false`. Annotations describe behavior; actual schema and
execution enforcement live in the SDK.

`examples/mcp-launch.json` is a **sample only**. Replace both absolute paths
with real paths and manually adapt it for your chosen MCP client. No settings
are changed automatically. Stdio access is authorized by the parent process
and OS permissions; the REST bearer token is not needed for MCP and should
not be passed to it. Launch with a trusted PATH to expose local tool discovery.

## Catalog, licensing and extension

The static catalog in `src/catalog.js` covers:

- Virtualization: QEMU, libvirt/virsh, Lima
- Disk rescue: smartmontools, GNU ddrescue
- Media: FFmpeg, SoX
- Archives: libarchive/bsdtar, GNU gzip
- Synchronization: rsync, rclone
- Local inference runtimes: llama.cpp, Ollama

Each entry records upstream/license links, upstream licensing, platforms,
an explicit executable name, fixed version arguments and capability boundaries.
Only the specified names are discovered: e.g. `llama-cli` is not inferred from
source files or a `llama-server` binary, and `qemu-system-x86_64` does not detect
other QEMU architectures. Missing executables are **unavailable**.

Parallels Desktop (including its App Store variant) is proprietary.
`prl-devops-service` is Fair Source, not FOSS. Both are informational
`external-only` entries with no executable or probe. Desktop installation
does not imply Toolbox, a standalone development SDK, or prldevops exists.
No proprietary binaries are copied or invoked.

To extend v1, edit the source catalog in a reviewed code change, supply upstream
license evidence, verify that the executable's fixed version invocation is
read-only and noninteractive, and add tests. The catalog and nested argument
arrays are immutable at runtime. No endpoint accepts catalog overrides.

The MIT license in this directory applies **only to this new application**,
not the repository, tools, operating systems, hypervisors, or models. Upstream
tool licenses are informational, not a software bill of materials for a
particular installed build. FFmpeg optional/nonfree components, rsync versions,
bundled libraries and packaging can change effective binary licensing.
**Model weights have separate licenses**; runtime availability never grants
model rights.

## Security boundary and outside v1

This app performs shallow PATH checks and explicit version probes only:

- No arbitrary commands, executable paths, flags, device paths or write options
  are accepted by SDK method inputs, REST or MCP.
- No shell is used. Children receive only a minimal environment, not the
  REST token, parent secrets, cloud credentials or runtime loader overrides.
  Probe output is combined, bounded and stripped of terminal control bytes.
- Timeout/output-limit termination kills the probe's process group on macOS/
  Linux, including ordinary wrapper descendants. This is resource bounding,
  **not a sandbox for malicious executables**.
- PATH, local binaries and symlink targets must be trusted and must not be
  writable by untrusted users. Discovery/execution cannot defend against an
  already-compromised local binary or host. No privilege elevation is used.
- There is no cloud telemetry, cloud API integration, or retained operation
  history. Logs contain only generic startup status/errors, not tokens or
  request headers. Output is evidence supplied by a local executable, not
  independently verified truth. Ollama's version command may check its local
  daemon; no model command is ever issued.
- No VM launches, guest execution, image creation/download, disk repair,
  device reads/writes, cleanup/deletion, archive/media processing,
  synchronization, deep source scanning, model downloads or inference.
- No operating-system installation, partition changes, physical-machine
  deployment, existing MCP registration, consent/royalty allocation changes,
  or modifications to existing recovery artifacts.

Tests use isolated temporary executable fixtures, HTTP requests to an ephemeral
loopback port and an actual official MCP stdio client/server initialize/list/call
exchange. A Linux test pass does not claim physical macOS validation.
