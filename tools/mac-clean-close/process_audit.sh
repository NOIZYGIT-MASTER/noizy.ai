#!/bin/bash
# process_audit.sh — REPORT-ONLY audit of what's running on the M2 Ultra vs.
# the "current build projects" allowlist. Prints suggested stop commands but
# NEVER executes them; stopping services stays a human decision.
set -u

# Current-build allowlist (edit to taste): one grep pattern per line.
ALLOW='
docker
com\.docker
mysqld
caddy
ghost
engr_keith_server
noizynet_daemon
ollama
Warp
Xcode
Terminal
Finder
'

is_allowed() {
  echo "$1" | grep -q -E "$(echo "$ALLOW" | sed '/^$/d' | paste -sd'|' -)"
}

echo "== process_audit (report-only) =="
echo

echo "-- Listening TCP ports --"
if command -v lsof >/dev/null; then
  lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR>1 {print $1, $9}' | sort -u | while read -r NAME PORT; do
    if is_allowed "$NAME"; then TAG="ALLOW"; else TAG="EXTRA"; fi
    printf '  [%s] %-24s %s\n' "$TAG" "$NAME" "$PORT"
  done
else
  echo "  lsof not available"
fi

echo
echo "-- User LaunchAgents (non-Apple) --"
if command -v launchctl >/dev/null; then
  launchctl list 2>/dev/null | awk 'NR>1 && $3 !~ /^com\.apple\./ {print $3}' | sort | while read -r LABEL; do
    if is_allowed "$LABEL"; then TAG="ALLOW"; else TAG="EXTRA"; fi
    printf '  [%s] %s\n' "$TAG" "$LABEL"
    [ "$TAG" = "EXTRA" ] && printf '          to stop: launchctl bootout gui/$(id -u) %s\n' "$LABEL"
  done
else
  echo "  launchctl not available (not macOS)"
fi

echo
echo "-- LaunchAgent plists on disk --"
for D in "$HOME/Library/LaunchAgents" /Library/LaunchAgents /Library/LaunchDaemons; do
  [ -d "$D" ] || continue
  ls "$D" 2>/dev/null | while read -r F; do
    if is_allowed "$F"; then TAG="ALLOW"; else TAG="EXTRA"; fi
    printf '  [%s] %s/%s\n' "$TAG" "$D" "$F"
  done
done

echo
echo "-- Top 10 memory consumers --"
ps axo rss,comm 2>/dev/null | sort -rn | head -11 | awk 'NR>1 {printf "  %6d MB  %s\n", $1/1024, $2}'

echo
echo "Review [EXTRA] items; nothing was stopped or removed by this script."
