# Mac Clean & Close — lean M2 Ultra, only current builds running

Toolkit to "complete clean and close" every git repo and reclaim excess on the
GOD machine, without losing a byte of work. Everything is **report/dry-run
first**, nothing deletes repos or data, and the running heaven Ghost stack is
explicitly protected.

Run on the M2 Ultra:
```bash
cd ~/noizy.ai && git pull
cd tools/mac-clean-close
```

## Order of operations

### 1. Sweep & close every repo (`repo_sweep.sh`)
```bash
./repo_sweep.sh ~/NOIZY ~/Desktop ~/Documents ~/Music /Volumes/12TB/03_CODE_AND_REPOS
```
Writes `~/Desktop/repo_sweep_<stamp>/repos.csv` classifying every repo:
`CLEAN_SYNCED` / `DIRTY` / `UNPUSHED` / `NO_REMOTE`. Then close the dirty ones:
```bash
./repo_sweep.sh --close --push ~/NOIZY ~/Desktop ~/Documents ~/Music
```
`--close` commits all WIP to a `rescue/close-<stamp>` branch and restores the
original branch (working tree ends clean). `--push` uploads the rescue branch
where a remote exists. Repos classified `NO_REMOTE` need a remote or a vault
copy before any archiving — give private ones a home (e.g. the private
CloudStorage repo) first.

**Deleting repo folders stays manual**: only `CLEAN_SYNCED` rows are
candidates, after you confirm the remote has everything.

### 2. De-duplicate data drives
Use the existing `tools/drive-rescue/` pipeline (audit → dry-run → execute,
receipts + undo). See its README.

### 3. Reclaim rebuildable caches (`lean_clean.sh`)
```bash
./lean_clean.sh            # dry-run with sizes
./lean_clean.sh --execute  # cleans ONLY auto-safe targets
```
Auto-safe: DerivedData, simulator caches, CocoaPods cache, npm/pip/brew
caches, `docker system prune -f` (dangling only — the heaven stack's
containers and volumes are untouched). Trash and Xcode Archives are listed
with sizes but never auto-emptied.

### 4. Only current builds running (`process_audit.sh`)
```bash
./process_audit.sh
```
Report-only: listening ports, non-Apple LaunchAgents, and plists tagged
`[ALLOW]` (current build: docker/ghost/mysql/caddy, engr_keith 7006,
noizynet 9699, ollama) or `[EXTRA]`, with the exact `launchctl bootout`
command printed for each extra. Edit the allowlist at the top of the script
to match the current epoch.

### 5. Special cases
- **THE-GATHERING**: follow `ops/runbooks/` guidance — read-only diff review,
  then rescue branch, then promote-vs-vault. Don't bulk-close it blind.
- **12TB (distrusted drive)**: run `git fsck --full` in relocated repos under
  `03_CODE_AND_REPOS/` before trusting or deleting anything there.
- **heaven** (`~/NOIZY/ghost/heaven`): already snapshotted to the private
  CloudStorage repo (`heaven-ghost-stack` branch); its `data/` dir is live
  database state — never "clean" it.
