# Drive Rescue Pipeline — audit, quarantine, undo

Safe, receipt-driven cleanup for the M2 Ultra drive consolidation
(NOIZY_POOL_A/B, 12TB extrication, DESIGN_REUNION). Rebuilt and hardened from
the original sandbox prototype, and validated end-to-end on synthetic drives
(`test_pipeline.sh` — all stages pass).

**Nothing in this pipeline ever deletes a file.** The audit is read-only; the
mover only relocates verified duplicates into a dated quarantine folder on the
same volume, with a receipt and a generated undo script.

## 1. Run on the GOD machine

```bash
cd ~/noizy.ai && git pull   # or clone the repo
cd tools/drive-rescue
./test_pipeline.sh          # optional: prove the pipeline on synthetic drives first
```

### Step 1 — Review-only audit

```bash
python3 drive_quality_dupe_audit.py \
    --source-root "/Volumes/NOIZY_POOL_A" \
    --source-root "/Volumes/NOIZY_POOL_B" \
    --source-root "/Volumes/12TB" \
    --output-parent "/Users/m2ultra/Music/NOIZYBEAZT/DESIGN_REUNION"
```

Produces `audit_<stamp>/duplicates.csv`, `low_quality.csv`
(WAVs < 44.1 kHz / < 16-bit, or unparseable), `no_metadata_watchlist.csv`
(extensionless files), and `summary.json` with bytes reclaimable.
Review the CSVs before going further.

### Step 2 — Dry-run the quarantine (default)

```bash
python3 quarantine_duplicates.py \
    "/Users/m2ultra/Music/NOIZYBEAZT/DESIGN_REUNION/audit_<stamp>/duplicates.csv"
```

Prints the full move plan as JSON. No files are touched without `--execute`.

### Step 3 — Execute

```bash
python3 quarantine_duplicates.py ".../duplicates.csv" --execute
```

### Step 4 — Undo (if ever needed)

```bash
sh ".../undo_quarantine_<stamp>.sh"
```

## 2. Safety model

- Dry-run by default; `--execute` is explicit.
- Canonical copy per group = first path in lexicographic order, re-derived by
  the mover and cross-checked against the CSV. Canonical is verified to exist
  with a matching sha256 **before** any sibling moves.
- Every duplicate's sha256 is re-verified immediately before its move; files
  changed since the audit are skipped ("hash changed since audit").
- Same-filesystem `os.rename()` only — atomic, instant, no data copying, no
  cross-device surprises.
- Quarantine: `<source_root>/_NOIZY_QUARANTINE_<stamp>/<relative path>` so
  provenance is readable from the folder tree itself.
- JSON receipt + executable undo script written next to the audit CSV.
- Audit skips `.git`, Spotlight/Trashes metadata, `node_modules`,
  `__pycache__`, symlinks, `.DS_Store`, and previous quarantine folders.

## 3. THE-GATHERING rescue runbook (still pending, run on the Mac)

Read-only inspection first — no `git add`, no checkout:

```bash
cd /Users/m2ultra/THE-GATHERING
git --no-pager status --porcelain
git --no-pager diff --stat
git --no-pager diff
```

Then preserve everything on a rescue branch before any reorganization:

```bash
git checkout -b rescue/wip-$(date +%Y-%m-%d)
git add -A && git commit -m "Rescue WIP snapshot before drive consolidation"
```

Promote-vs-vault decisions (from the prior review): promote
`apps/design-show/` (excluding `__pycache__`), `scripts/media-timeline*.py`,
tests and docs after diff review; keep raw media (`personas/portraits/`) in
NOIZYVAULT; verify the deleted
`governance/routes/n8n_forgejo_to_infomaniak_community_release.json` and the
`CORES/knowledge-ingest/THE-GATHERING` submodule pointer before committing
them anywhere.

Integrity check for repos relocated during the 12TB extrication (that drive
was flagged distrusted):

```bash
for r in /Volumes/12TB/03_CODE_AND_REPOS/*/; do
  [ -d "$r/.git" ] && (cd "$r" && echo "== $r" && git fsck --full --no-dangling)
done
```

## 4. Why this can't run from the cloud sandbox

These scripts operate on `/Volumes/*` and `/Users/m2ultra/*`, which exist only
on the Mac Studio. The sandbox validated the logic on synthetic drives; the
real run is a copy-paste of the commands above in a local Warp session.
