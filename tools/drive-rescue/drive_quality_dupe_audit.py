#!/usr/bin/env python3
"""
drive_quality_dupe_audit.py — REVIEW-ONLY audit of one or more drive roots.

Nothing is moved, deleted, or modified. Outputs land in a dated audit folder:

    <output-parent>/audit_<YYYYMMDD-HHMMSS>/
        duplicates.csv      exact duplicate groups (size pre-filter + sha256)
        low_quality.csv     WAVs below 44.1kHz/16-bit, or unparseable
        no_metadata_watchlist.csv  extensionless / suspicious files
        summary.json        counts, bytes reclaimable, parameters used

Example (M2 Ultra):
    python3 drive_quality_dupe_audit.py \
        --source-root "/Volumes/NOIZY_POOL_A" \
        --source-root "/Volumes/NOIZY_POOL_B" \
        --source-root "/Volumes/12TB" \
        --output-parent "/Users/m2ultra/Music/NOIZYBEAZT/DESIGN_REUNION"

duplicates.csv columns:
    group_id, sha256, size_bytes, source_root, path, is_canonical
Canonical = first path in lexicographic order within the group. The
quarantine mover re-derives this independently and verifies sha256 again.
"""

import argparse
import csv
import hashlib
import json
import os
import sys
import wave
from collections import defaultdict
from datetime import datetime
from pathlib import Path

CHUNK = 1024 * 1024
SKIP_DIR_NAMES = {
    ".git", ".Trashes", ".Spotlight-V100", ".fseventsd", ".TemporaryItems",
    "__pycache__", "node_modules", ".DocumentRevisions-V100",
}
SKIP_DIR_PREFIXES = ("_NOIZY_QUARANTINE", "_QUARANTINE")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIR_NAMES and not d.startswith(SKIP_DIR_PREFIXES)
        ]
        for name in filenames:
            if name == ".DS_Store":
                continue
            p = Path(dirpath) / name
            if p.is_symlink():
                continue
            yield p


def wav_quality(path: Path):
    """Return (ok, detail). ok=False means low quality or unparseable."""
    try:
        with wave.open(str(path), "rb") as w:
            rate, width, channels = w.getframerate(), w.getsampwidth(), w.getnchannels()
        if rate < 44100 or width < 2:
            return False, f"{rate}Hz/{width * 8}bit/{channels}ch"
        return True, f"{rate}Hz/{width * 8}bit/{channels}ch"
    except Exception as e:  # compressed/non-PCM/corrupt WAV
        return False, f"unparseable: {e.__class__.__name__}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Review-only duplicate/quality audit.")
    ap.add_argument("--source-root", action="append", required=True, dest="roots",
                    help="Drive root to scan; repeatable.")
    ap.add_argument("--output-parent", required=True,
                    help="Directory in which the dated audit folder is created.")
    ap.add_argument("--min-size", type=int, default=1,
                    help="Ignore files smaller than this many bytes (default 1).")
    args = ap.parse_args()

    roots = []
    for r in args.roots:
        root = Path(r).expanduser()
        if not root.is_dir():
            print(f"ERROR: source root not found: {root}", file=sys.stderr)
            return 2
        roots.append(root.resolve())

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.output_parent).expanduser() / f"audit_{stamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Pass 1: inventory by size (cheap pre-filter).
    by_size: dict[int, list[tuple[Path, Path]]] = defaultdict(list)
    watchlist: list[tuple[Path, Path, int, str]] = []
    low_quality: list[tuple[Path, Path, int, str]] = []
    total_files = 0
    errors: list[str] = []

    for root in roots:
        for p in iter_files(root):
            try:
                size = p.stat().st_size
            except OSError as e:
                errors.append(f"stat failed: {p} ({e})")
                continue
            total_files += 1
            if size < args.min_size:
                continue
            by_size[size].append((root, p))
            if p.suffix == "":
                watchlist.append((root, p, size, "no file extension"))
            elif p.suffix.lower() == ".wav":
                ok, detail = wav_quality(p)
                if not ok:
                    low_quality.append((root, p, size, detail))

    # Pass 2: hash only size-colliding files.
    by_hash: dict[tuple[str, int], list[tuple[Path, Path]]] = defaultdict(list)
    hashed = 0
    for size, entries in by_size.items():
        if len(entries) < 2:
            continue
        for root, p in entries:
            try:
                digest = sha256_of(p)
            except OSError as e:
                errors.append(f"hash failed: {p} ({e})")
                continue
            hashed += 1
            by_hash[(digest, size)].append((root, p))

    # Emit duplicates.csv
    dup_groups = 0
    reclaimable = 0
    dup_csv = out_dir / "duplicates.csv"
    with open(dup_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["group_id", "sha256", "size_bytes", "source_root", "path", "is_canonical"])
        for (digest, size), entries in sorted(by_hash.items()):
            if len(entries) < 2:
                continue
            dup_groups += 1
            group_id = f"g{dup_groups:06d}"
            entries_sorted = sorted(entries, key=lambda rp: str(rp[1]))
            for i, (root, p) in enumerate(entries_sorted):
                w.writerow([group_id, digest, size, str(root), str(p),
                            "yes" if i == 0 else "no"])
                if i > 0:
                    reclaimable += size

    with open(out_dir / "low_quality.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_root", "path", "size_bytes", "detail"])
        for root, p, size, detail in sorted(low_quality, key=lambda t: str(t[1])):
            w.writerow([str(root), str(p), size, detail])

    with open(out_dir / "no_metadata_watchlist.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_root", "path", "size_bytes", "reason"])
        for root, p, size, reason in sorted(watchlist, key=lambda t: str(t[1])):
            w.writerow([str(root), str(p), size, reason])

    summary = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "source_roots": [str(r) for r in roots],
        "total_files_seen": total_files,
        "files_hashed": hashed,
        "duplicate_groups": dup_groups,
        "bytes_reclaimable_if_quarantined": reclaimable,
        "low_quality_wavs": len(low_quality),
        "no_metadata_files": len(watchlist),
        "errors": errors,
        "outputs": {
            "duplicates": str(dup_csv),
            "low_quality": str(out_dir / "low_quality.csv"),
            "watchlist": str(out_dir / "no_metadata_watchlist.csv"),
        },
        "note": "REVIEW ONLY — nothing was moved, deleted, or modified.",
    }
    with open(out_dir / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
