#!/usr/bin/env bash
# End-to-end validation of the drive-rescue pipeline on synthetic drives.
# Safe to run anywhere; everything happens in a temp directory.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/drive_rescue_test_XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
echo "work dir: $WORK"

DRIVE_A="$WORK/DRIVE_A"
DRIVE_B="$WORK/DRIVE_B"
OUT="$WORK/out"
mkdir -p "$DRIVE_A/sessions/take1" "$DRIVE_A/samples" "$DRIVE_B/backup/take1" "$OUT"

# --- Fixtures -----------------------------------------------------------
# dup group 1: same bytes in three places across two "drives"
printf 'NEUMANN TAKE ONE — identical bytes' > "$DRIVE_A/sessions/take1/vocal.txt"
cp "$DRIVE_A/sessions/take1/vocal.txt" "$DRIVE_A/samples/vocal_copy.txt"
cp "$DRIVE_A/sessions/take1/vocal.txt" "$DRIVE_B/backup/take1/vocal.txt"
# dup group 2: pair on one drive
printf 'ANOTHER DUPLICATE PAYLOAD' > "$DRIVE_A/samples/kick.txt"
cp "$DRIVE_A/samples/kick.txt" "$DRIVE_A/samples/kick (1).txt"
# unique file: must never be touched
printf 'UNIQUE FILE' > "$DRIVE_A/samples/unique.txt"
# low-quality WAV fixture: 22050 Hz / 8-bit
python3 - "$DRIVE_A/samples/low_quality.wav" <<'PY'
import sys, wave
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(1); w.setframerate(22050)
    w.writeframes(b"\x80" * 2205)
PY
# good WAV fixture: 48000 Hz / 16-bit
python3 - "$DRIVE_A/samples/good.wav" <<'PY'
import sys, wave
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(b"\x00\x00" * 4800)
PY
# extensionless file for the watchlist
printf 'mystery bytes' > "$DRIVE_A/samples/MYSTERYFILE"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- 1. Audit ------------------------------------------------------------
python3 "$HERE/drive_quality_dupe_audit.py" \
    --source-root "$DRIVE_A" --source-root "$DRIVE_B" \
    --output-parent "$OUT" > "$WORK/audit.json"
AUDIT_DIR=$(ls -d "$OUT"/audit_*)
DUP_CSV="$AUDIT_DIR/duplicates.csv"

grep -q 'duplicate_groups": 2' "$WORK/audit.json" || fail "expected 2 duplicate groups"
grep -q 'low_quality.wav' "$AUDIT_DIR/low_quality.csv" || fail "low-quality WAV not flagged"
grep -q 'good.wav' "$AUDIT_DIR/low_quality.csv" && fail "good WAV wrongly flagged"
grep -q 'MYSTERYFILE' "$AUDIT_DIR/no_metadata_watchlist.csv" || fail "extensionless file not watchlisted"
echo "PASS: audit outputs correct"

# --- 2. Dry-run must not move anything ------------------------------------
python3 "$HERE/quarantine_duplicates.py" "$DUP_CSV" > "$WORK/dryrun.json"
grep -q 'DRY-RUN' "$WORK/dryrun.json" || fail "dry-run banner missing"
[ "$(find "$DRIVE_A" "$DRIVE_B" -name '_NOIZY_QUARANTINE*' | wc -l)" -eq 0 ] || fail "dry-run created quarantine"
[ -f "$DRIVE_A/samples/vocal_copy.txt" ] || fail "dry-run moved a file"
grep -q '"planned_moves": 3' "$WORK/dryrun.json" || fail "expected 3 planned moves"
echo "PASS: dry-run plans 3 moves, touches nothing"

# --- 3. Execute ------------------------------------------------------------
python3 "$HERE/quarantine_duplicates.py" "$DUP_CSV" --execute > "$WORK/exec.json"
grep -q '"moved": 3' "$WORK/exec.json" || fail "expected 3 files moved"
# canonicals (lexicographic-first) stay; non-canonicals are gone from origin
[ -f "$DRIVE_A/samples/kick (1).txt" ] || fail "canonical 'kick (1).txt' was moved"
[ ! -f "$DRIVE_A/samples/kick.txt" ] || fail "duplicate kick.txt not quarantined"
[ -f "$DRIVE_A/samples/vocal_copy.txt" ] || fail "canonical vocal_copy.txt was moved"
[ ! -f "$DRIVE_A/sessions/take1/vocal.txt" ] || fail "duplicate vocal.txt (A) not quarantined"
[ ! -f "$DRIVE_B/backup/take1/vocal.txt" ] || fail "duplicate vocal.txt (B) not quarantined"
[ -f "$DRIVE_A/samples/unique.txt" ] || fail "unique file was touched"
# relative paths preserved inside quarantine, per-drive
ls "$DRIVE_A"/_NOIZY_QUARANTINE_*/sessions/take1/vocal.txt >/dev/null || fail "A-quarantine lost relative path"
ls "$DRIVE_B"/_NOIZY_QUARANTINE_*/backup/take1/vocal.txt   >/dev/null || fail "B-quarantine lost relative path"
RECEIPT=$(ls "$AUDIT_DIR"/quarantine_receipt_*.json)
UNDO=$(ls "$AUDIT_DIR"/undo_quarantine_*.sh)
python3 -c "import json;d=json.load(open('$RECEIPT'));assert len(d['moved'])==3"
echo "PASS: execute moved exactly the 3 duplicates with receipts"

# --- 4. Undo ---------------------------------------------------------------
sh "$UNDO" >/dev/null
[ -f "$DRIVE_A/sessions/take1/vocal.txt" ] || fail "undo did not restore vocal.txt (A)"
[ -f "$DRIVE_B/backup/take1/vocal.txt" ] || fail "undo did not restore vocal.txt (B)"
[ -f "$DRIVE_A/samples/kick.txt" ] || fail "undo did not restore kick.txt"
echo "PASS: undo restored all 3 files"

# --- 5. Tamper guard: re-execute after content change skips the file --------
python3 "$HERE/quarantine_duplicates.py" "$DUP_CSV" --execute > /dev/null  # re-quarantine
sh "$(ls -t "$AUDIT_DIR"/undo_quarantine_*.sh | head -1)" > /dev/null       # restore again
printf 'TAMPERED' >> "$DRIVE_A/sessions/take1/vocal.txt"
python3 "$HERE/quarantine_duplicates.py" "$DUP_CSV" --execute > "$WORK/tamper.json"
grep -q 'hash changed since audit' "$WORK/tamper.json" || fail "tampered file not skipped"
[ -f "$DRIVE_A/sessions/take1/vocal.txt" ] || fail "tampered file was moved anyway"
echo "PASS: sha256 tamper guard skips changed files"

echo
echo "ALL TESTS PASSED"
