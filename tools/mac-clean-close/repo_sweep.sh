#!/bin/bash
# repo_sweep.sh — inventory and safely "close" every git repo under given roots.
# macOS bash 3.2 compatible. REPORT-ONLY by default; never deletes anything.
#
#   ./repo_sweep.sh ~/NOIZY ~/Desktop ~/Documents            # report only
#   ./repo_sweep.sh --close ~/NOIZY                          # + commit WIP to rescue/close-<date> branches
#   ./repo_sweep.sh --close --push ~/NOIZY                   # + push rescue branch when a remote exists
#
# "Close" means: all work committed on a rescue branch, original branch
# restored, working tree clean. Deleting repo folders stays a human decision —
# the report tells you which are CLEAN_SYNCED (safe to archive/remove).
set -u

CLOSE=0; PUSH=0; ROOTS=""
for a in "$@"; do
  case "$a" in
    --close) CLOSE=1 ;;
    --push)  PUSH=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ROOTS="$ROOTS $a" ;;
  esac
done
[ -z "$ROOTS" ] && { echo "usage: $0 [--close] [--push] <root> [root...]"; exit 2; }

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$HOME/Desktop/repo_sweep_$STAMP"
mkdir -p "$OUT"
CSV="$OUT/repos.csv"
echo "repo,branch,dirty,untracked,stashes,unpushed_commits,remote,classification,action" > "$CSV"

n_total=0; n_clean=0; n_closed=0; n_attention=0

for ROOT in $ROOTS; do
  [ -d "$ROOT" ] || { echo "skip (missing): $ROOT"; continue; }
  # -prune stops descent into a repo, so nested checkouts under data dirs still surface once.
  find "$ROOT" \( -name .Trash -o -name 'Backups.backupdb' -o -name node_modules \) -prune -o \
       -name .git -maxdepth 8 -print -prune 2>/dev/null | while read -r GITDIR; do
    REPO=$(dirname "$GITDIR")
    cd "$REPO" 2>/dev/null || continue
    git rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue

    BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")
    DIRTY=$(git status --porcelain 2>/dev/null | grep -c -v '^??')
    UNTRACKED=$(git status --porcelain 2>/dev/null | grep -c '^??')
    STASHES=$(git stash list 2>/dev/null | wc -l | tr -d ' ')
    REMOTE=$(git remote 2>/dev/null | head -1)
    if [ -n "$REMOTE" ]; then
      UNPUSHED=$(git log --branches --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' ')
    else
      UNPUSHED=$(git rev-list --all --count 2>/dev/null || echo 0)
    fi

    CLASS="CLEAN_SYNCED"; ACTION="archive-or-keep"
    if [ "$DIRTY" -gt 0 ] || [ "$UNTRACKED" -gt 0 ] || [ "$STASHES" -gt 0 ]; then
      CLASS="DIRTY"; ACTION="needs-close"
    elif [ -z "$REMOTE" ]; then
      CLASS="NO_REMOTE"; ACTION="needs-remote-or-vault"
    elif [ "$UNPUSHED" -gt 0 ]; then
      CLASS="UNPUSHED"; ACTION="needs-push"
    fi

    if [ "$CLOSE" = "1" ] && [ "$CLASS" = "DIRTY" ]; then
      ORIG="$BRANCH"
      RB="rescue/close-$STAMP"
      if git checkout -q -b "$RB" 2>/dev/null; then
        git add -A >/dev/null 2>&1
        if git commit -q -m "Rescue WIP snapshot (repo_sweep close $STAMP)" >/dev/null 2>&1; then
          ACTION="closed:$RB"
          n_closed=$((n_closed + 1))
          if [ "$PUSH" = "1" ] && [ -n "$REMOTE" ]; then
            git push -q -u "$REMOTE" "$RB" >/dev/null 2>&1 && ACTION="$ACTION,pushed" || ACTION="$ACTION,push-FAILED"
          fi
        else
          ACTION="close-FAILED(commit)"
        fi
        [ "$ORIG" != "DETACHED" ] && git checkout -q "$ORIG" 2>/dev/null
      else
        ACTION="close-FAILED(branch)"
      fi
    fi

    echo "\"$REPO\",$BRANCH,$DIRTY,$UNTRACKED,$STASHES,$UNPUSHED,${REMOTE:-none},$CLASS,$ACTION" >> "$CSV"
    case "$CLASS" in CLEAN_SYNCED) n_clean=$((n_clean+1));; *) n_attention=$((n_attention+1));; esac
    n_total=$((n_total+1))
    printf '%-14s %s (%s)\n' "[$CLASS]" "$REPO" "$ACTION"
  done
done

echo
echo "Report: $CSV"
echo "Review the CSV; CLEAN_SYNCED repos are safe to archive or remove BY HAND."
echo "This script never deletes repositories."
