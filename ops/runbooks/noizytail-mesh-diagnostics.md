# NOIZYTAIL Mesh Diagnostics — Tailscale on the M2 Ultra

Status as verified 2026-11-06 (cloud-side checks, see "Verified findings").
Goal: identify which coordinator the active **"Tailscale 3"** VPN profile
uses, and prove iPhone ↔ Mac reachability over that mesh.

## Verified findings (checked from outside the LAN)

1. **`noizytail.net` has no public DNS at all** — NXDOMAIN from public
   resolvers, not just from the Mac. Any health check against
   `noizytail.net` can never succeed anywhere until the domain has a DNS
   zone. This is a deployment gap, not a Mac misconfiguration.
2. `noizy.ai` resolves (Cloudflare), but `headscale.noizy.ai` and
   `vpn.noizy.ai` do not exist. No self-hosted coordinator is reachable
   under any known name, and none is documented in this repo.
3. The symptom pair reported on the Mac — GUI says "Tailscale 3:
   connected" while `tailscale` CLI says *backend stopped, hosted
   coordinator* — is the classic **dual-install split** on macOS: the CLI
   talks to the standalone `tailscaled` daemon's socket, which is a
   *different instance* from the GUI app's Network Extension. The CLI was
   interrogating a stopped daemon, not the active profile.
4. A profile named "Tailscale 3" means macOS has accumulated at least three
   Tailscale VPN profiles from repeated installs. The numbered ones are
   usually stale duplicates.

## Step 1 — Identify the active profile's coordinator (run on the Mac)

```bash
# Which VPN profiles exist and which is connected
scutil --nc list

# Query the GUI app's own instance (NOT the standalone CLI daemon)
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
/Applications/Tailscale.app/Contents/MacOS/Tailscale debug prefs | grep -i controlurl

# For comparison, the standalone daemon the bare CLI talks to
tailscale status; tailscale debug prefs 2>/dev/null | grep -i controlurl

# The live mesh interface + 100.x address
ifconfig | grep -B2 'inet 100\.'
```

Interpretation:
- `ControlURL: https://controlplane.tailscale.com` → hosted Tailscale
  coordinator (a tailnet on tailscale.com — "NOIZYTAIL" is then just the
  tailnet's name, and `noizytail.net` was never its hostname; MagicDNS
  names end in `.ts.net`).
- Any other URL → self-hosted Headscale; that URL is the coordinator to
  health-check, not `noizytail.net`.

## Step 2 — Prove iPhone ↔ Mac reachability on the same mesh

```bash
# List peers; find the iPhone's name and 100.x address
/Applications/Tailscale.app/Contents/MacOS/Tailscale status

# Direct mesh ping (works even when ICMP is blocked — it's a disco ping)
/Applications/Tailscale.app/Contents/MacOS/Tailscale ping <iphone-name-or-100.x.y.z>
```

On the iPhone, the Tailscale app's peer list must show the Mac as
reachable; then from the iPhone, opening `http://<mac-100.x>:7006/status`
(ENGR_KEITH) is the end-to-end proof that matters for NOIZY Control.

## Step 3 — Clean up the duplicate installs/profiles

Pick ONE variant and remove the rest:
- **GUI app** (recommended on the GOD machine): keep Tailscale.app, then
  System Settings → VPN → delete the stale "Tailscale" / "Tailscale 2"
  profiles, and `brew uninstall tailscale` if the brew daemon is installed.
- **Headless daemon**: `brew install tailscale && sudo tailscaled
  install-system-daemon`, and delete the GUI app + all its VPN profiles.

## Step 4 — Decide what NOIZYTAIL actually is

Two valid end-states; both fix the failed health check:
- **Hosted tailnet (fastest)**: keep `controlplane.tailscale.com`, rename
  the tailnet "noizytail", health-check with
  `tailscale status --json` locally. `noizytail.net` is then unnecessary.
- **Self-hosted Headscale at `noizytail.net`**: requires registering the
  domain + DNS A record + deploying Headscale (it can sit behind the
  existing Cloudflare account like heaven does), then
  `tailscale up --login-server https://noizytail.net` on every device.
  Until that exists, nothing should health-check `noizytail.net`.
