#!/bin/bash
# lean_clean.sh — reclaim disk from SAFE, rebuildable caches on the M2 Ultra.
# DRY-RUN by default: prints each target with its size. Pass --execute to clean.
# Never touches project code, documents, media, or the running Ghost stack's
# data (docker prune here removes dangling layers only, never named volumes
# or running containers).
set -u

EXEC=0
[ "${1:-}" = "--execute" ] && EXEC=1

total_kb=0
say() { printf '%s\n' "$*"; }

size_of() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

target_dir() { # <label> <path> <rm-contents:0|1>
  LABEL="$1"; P="$2"; RMC="$3"
  [ -e "$P" ] || return 0
  KB=$(size_of "$P"); [ -z "$KB" ] && KB=0
  total_kb=$((total_kb + KB))
  say "  $(printf '%8d' $((KB/1024))) MB  $LABEL  ($P)"
  if [ "$EXEC" = "1" ] && [ "$RMC" = "1" ]; then
    rm -rf "${P:?}"/* "${P:?}"/.[!.]* 2>/dev/null
    say "           ^ cleaned"
  fi
}

say "== lean_clean $( [ $EXEC = 1 ] && echo EXECUTE || echo DRY-RUN ) =="
say ""
say "-- Rebuildable developer caches --"
target_dir "Xcode DerivedData"        "$HOME/Library/Developer/Xcode/DerivedData" 1
target_dir "Xcode Archives (review!)" "$HOME/Library/Developer/Xcode/Archives" 0
target_dir "CoreSimulator caches"     "$HOME/Library/Developer/CoreSimulator/Caches" 1
target_dir "npm cache"                "$HOME/.npm/_cacache" 0
target_dir "pip cache"                "$HOME/Library/Caches/pip" 0
target_dir "Homebrew cache"           "$(brew --cache 2>/dev/null || echo /nonexistent)" 0
target_dir "CocoaPods cache"          "$HOME/Library/Caches/CocoaPods" 1
target_dir "Trash"                    "$HOME/.Trash" 0

say ""
say "-- Tool-managed cleans (run their own safe eviction) --"
if [ "$EXEC" = "1" ]; then
  command -v npm  >/dev/null && npm cache clean --force >/dev/null 2>&1 && say "  npm cache clean: done"
  command -v pip3 >/dev/null && pip3 cache purge >/dev/null 2>&1 && say "  pip cache purge: done"
  command -v brew >/dev/null && brew cleanup -s >/dev/null 2>&1 && say "  brew cleanup -s: done"
  if command -v docker >/dev/null; then
    # Dangling images + stopped one-off containers + build cache ONLY.
    # No -a, no --volumes: the heaven Ghost stack and its data are untouched.
    docker system prune -f 2>/dev/null | tail -1
  fi
  command -v xcrun >/dev/null && xcrun simctl delete unavailable >/dev/null 2>&1 && say "  unavailable simulators deleted"
else
  say "  would run: npm cache clean --force"
  say "  would run: pip3 cache purge"
  say "  would run: brew cleanup -s"
  say "  would run: docker system prune -f   (dangling only — stack data safe)"
  say "  would run: xcrun simctl delete unavailable"
fi

say ""
say "-- Trash & Archives are listed but NOT auto-emptied; empty by hand after review --"
say ""
say "Total in listed dirs: $((total_kb/1024)) MB"
[ "$EXEC" = "0" ] && say "Dry-run. Re-run with --execute to clean the auto-safe targets."
