#!/usr/bin/env python3
"""
quarantine_duplicates.py — relocate VERIFIED duplicate copies into a dated
quarantine folder on the same volume. Never deletes anything.

Safety model:
  * DRY-RUN by default; pass --execute to actually move files.
  * One canonical copy per duplicate group is kept in place (first path in
    lexicographic order, re-derived here — the CSV's is_canonical column is
    cross-checked, not trusted).
  * Every file's sha256 is re-verified immediately before its move; any
    mismatch (file changed since audit) skips that file.
  * The canonical copy's existence and hash are verified before any sibling
    in the group is moved.
  * Moves are same-filesystem os.rename() only — atomic, no data copying.
    Quarantine lives at <source_root>/_NOIZY_QUARANTINE_<YYYYMMDD-HHMMSS>/
    with the file's path relative to its source root preserved beneath it.
  * A JSON receipt and an executable undo_quarantine.sh are written next to
    the quarantine folder; the undo script restores every move.

Usage:
    python3 quarantine_duplicates.py /path/to/audit_.../duplicates.csv            # dry-run
    python3 quarantine_duplicates.py /path/to/audit_.../duplicates.csv --execute  # move
"""

import argparse
import csv
import hashlib
import json
import os
import shlex
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

CHUNK = 1024 * 1024


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def load_groups(csv_path: Path):
    groups: dict[str, list[dict]] = defaultdict(list)
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        required = {"group_id", "sha256", "size_bytes", "source_root", "path", "is_canonical"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"duplicates.csv missing columns: {sorted(missing)}")
        for row in reader:
            groups[row["group_id"]].append(row)
    return groups


def unique_dest(dest: Path) -> Path:
    """Avoid collisions inside the quarantine tree."""
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    for i in range(1, 10000):
        cand = dest.with_name(f"{stem}__dup{i}{suffix}")
        if not cand.exists():
            return cand
    raise SystemExit(f"could not find unique destination for {dest}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Quarantine verified duplicate copies (dry-run by default).")
    ap.add_argument("duplicates_csv", help="duplicates.csv produced by drive_quality_dupe_audit.py")
    ap.add_argument("--execute", action="store_true",
                    help="Actually move files. Without this flag, prints the plan only.")
    ap.add_argument("--quarantine-prefix", default="_NOIZY_QUARANTINE",
                    help="Quarantine folder name prefix created at each source root.")
    args = ap.parse_args()

    csv_path = Path(args.duplicates_csv).expanduser().resolve()
    if not csv_path.is_file():
        print(f"ERROR: not found: {csv_path}", file=sys.stderr)
        return 2

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    groups = load_groups(csv_path)

    planned, moved, skipped = [], [], []
    quarantine_roots: dict[str, Path] = {}

    for group_id, rows in sorted(groups.items()):
        if len(rows) < 2:
            skipped.append({"group": group_id, "reason": "fewer than 2 rows"})
            continue

        expected_sha = rows[0]["sha256"]
        rows_sorted = sorted(rows, key=lambda r: r["path"])
        canonical = rows_sorted[0]
        csv_canonical = [r for r in rows if r["is_canonical"] == "yes"]
        if csv_canonical and csv_canonical[0]["path"] != canonical["path"]:
            skipped.append({"group": group_id,
                            "reason": f"canonical mismatch vs CSV: {csv_canonical[0]['path']}"})
            continue

        canon_path = Path(canonical["path"])
        if not canon_path.is_file():
            skipped.append({"group": group_id, "reason": f"canonical missing: {canon_path}"})
            continue
        try:
            if sha256_of(canon_path) != expected_sha:
                skipped.append({"group": group_id, "reason": f"canonical hash changed: {canon_path}"})
                continue
        except OSError as e:
            skipped.append({"group": group_id, "reason": f"canonical unreadable: {canon_path} ({e})"})
            continue

        for row in rows_sorted[1:]:
            src = Path(row["path"])
            source_root = Path(row["source_root"])
            entry = {"group": group_id, "src": str(src)}

            if not src.is_file():
                skipped.append({**entry, "reason": "source missing"})
                continue
            try:
                actual = sha256_of(src)
            except OSError as e:
                skipped.append({**entry, "reason": f"unreadable ({e})"})
                continue
            if actual != expected_sha:
                skipped.append({**entry, "reason": "hash changed since audit"})
                continue

            try:
                rel = src.resolve().relative_to(source_root.resolve())
            except ValueError:
                skipped.append({**entry, "reason": f"not under source_root {source_root}"})
                continue

            qroot = quarantine_roots.setdefault(
                str(source_root), source_root / f"{args.quarantine_prefix}_{stamp}")
            dest = qroot / rel

            # Same-filesystem guard: rename must not cross devices.
            if src.stat().st_dev != source_root.stat().st_dev:
                skipped.append({**entry, "reason": "crosses filesystem boundary"})
                continue

            entry.update({"dest": str(dest), "sha256": expected_sha,
                          "size_bytes": int(row["size_bytes"])})
            planned.append(entry)

            if args.execute:
                dest.parent.mkdir(parents=True, exist_ok=True)
                final_dest = unique_dest(dest)
                os.rename(src, final_dest)  # atomic same-fs move
                entry["dest"] = str(final_dest)
                entry["moved_at"] = datetime.now().astimezone().isoformat()
                moved.append(entry)

    # Receipts + undo script (execute mode only).
    receipt_path = undo_path = None
    if args.execute and moved:
        receipt_dir = csv_path.parent
        receipt_path = receipt_dir / f"quarantine_receipt_{stamp}.json"
        undo_path = receipt_dir / f"undo_quarantine_{stamp}.sh"
        with open(receipt_path, "w") as f:
            json.dump({
                "executed_at": datetime.now().astimezone().isoformat(),
                "duplicates_csv": str(csv_path),
                "quarantine_roots": {k: str(v) for k, v in quarantine_roots.items()},
                "moved": moved,
                "skipped": skipped,
            }, f, indent=2)
        with open(undo_path, "w") as f:
            f.write("#!/bin/sh\n# Undo script generated by quarantine_duplicates.py\n")
            f.write("# Restores every quarantined file to its original location.\nset -e\n")
            for m in reversed(moved):
                f.write(f"mkdir -p {shlex.quote(str(Path(m['src']).parent))}\n")
                f.write(f"mv {shlex.quote(m['dest'])} {shlex.quote(m['src'])}\n")
            f.write("echo 'Undo complete.'\n")
        os.chmod(undo_path, 0o755)

    summary = {
        "mode": "EXECUTE" if args.execute else "DRY-RUN (no files moved; pass --execute)",
        "groups": len(groups),
        "planned_moves": len(planned),
        "moved": len(moved),
        "skipped": len(skipped),
        "bytes_quarantined": sum(m["size_bytes"] for m in moved),
        "receipt": str(receipt_path) if receipt_path else None,
        "undo_script": str(undo_path) if undo_path else None,
    }
    print(json.dumps({"summary": summary,
                      "plan": planned if not args.execute else moved,
                      "skipped": skipped}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
