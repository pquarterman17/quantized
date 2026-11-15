"""``qz convert`` -- batch-convert Origin projects with no Origin installed.

    qz convert *.opj archive/**/*.opju --to xlsx --out converted/
    qz convert run1.opj --to csv --out out/ --allow-partial

Every book and sheet of every project is written (naming and the per-book
fail-closed rule: :mod:`quantized.io.origin_convert`). Globs are expanded
here as well as by the shell, so they work on Windows ``cmd`` too, and ``**``
recurses. Each input gets one summary line on stdout, and the whole run a
JSON report, ``<out>/convert-report.json`` (``--report`` moves it), with
every file's books, outputs and problems.

Nothing is overwritten (``io/write_guard.py``): an output or report that
already exists is refused -- the book is skipped with "exists, not
overwritten" -- unless ``--overwrite`` is given; and even then no output or
report is ever written to an input, into one, or through a symlink to one.

Exit status: 0 when every file converted completely; 1 when any file failed
or was only partly converted (a book skipped, a project-level omission);
2 for a usage error, including no input matching.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quantized.io.origin_convert import CONVERT_FORMATS, convert_origin_project, safe_name
from quantized.io.write_guard import WriteRefused, check_target

__all__ = ["convert_command", "expand_inputs", "unique_prefixes"]

_REPORT_NAME = "convert-report.json"


def expand_inputs(patterns: list[str]) -> tuple[list[Path], list[str]]:
    """``(files, unmatched)`` for ``patterns``, files in the order given,
    each once.

    A pattern naming a path that EXISTS is taken literally, before any glob
    expansion -- ``sample[2].opj`` is a file name, not a character class.
    Otherwise a pattern with glob characters is expanded (``**`` recurses), and
    one that matches nothing is returned in ``unmatched``; a literal path that
    does not exist is kept, so the report says "file not found". A directory
    is not an input (``unmatched`` too)."""
    seen: set[Path] = set()
    out: list[Path] = []
    unmatched: list[str] = []
    for pattern in patterns:
        if os.path.exists(pattern) or not glob.has_magic(pattern):
            matches = [pattern]
        else:
            matches = sorted(glob.glob(pattern, recursive=True))
        files = [Path(m) for m in matches if not Path(m).is_dir()]
        if not files:
            unmatched.append(pattern)
        for p in files:
            key = p.resolve()
            if key not in seen:
                seen.add(key)
                out.append(p)
    return out, unmatched


def _failed(source: str, error: str) -> dict[str, Any]:
    return {
        "source": source,
        "status": "failed",
        "error": error,
        "outputs": [],
        "omissions": [],
        "notes": [],
        "books": [],
    }


def unique_prefixes(paths: list[Path]) -> list[str]:
    """Output prefix per input: its file name (``run1.opj``), with ``~2``,
    ``~3`` … for a later input whose name repeats one already used (the same
    file name in two folders), so no output overwrites another."""
    taken: set[str] = set()
    out: list[str] = []
    for p in paths:
        base = safe_name(p.name)
        name, k = base, 2
        while name.lower() in taken:
            name, k = f"{base}~{k}", k + 1
        taken.add(name.lower())
        out.append(name)
    return out


def _line(entry: dict[str, Any]) -> str:
    """One input's summary: status, what was written, and every book that
    was skipped (or written incomplete) with the reader's reasons."""
    books = entry["books"]
    written = sum(b["status"] in ("written", "partial") for b in books)
    parts: list[str] = [entry["error"]] if entry["error"] else []
    if books:
        files = len(entry["outputs"])
        parts.append(f"{written} of {len(books)} sheet(s) written -> {files} file(s)")
    for b in books:
        if b["problems"]:
            what = {"skipped": "skipped", "partial": "written INCOMPLETE"}.get(b["status"], "empty")
            parts.append(f"{what} {b['book']} sheet {b['sheet']}: {'; '.join(b['problems'])}")
    parts += [f"not recovered: {o}" for o in entry["omissions"]]
    parts += [f"note: {n}" for n in entry.get("notes", [])]
    parts += [f"note: {b['book']} sheet {b['sheet']}: {n}" for b in books for n in b["notes"]]
    return f"[{entry['status']:>7}] {entry['source']}" + "".join(f"\n    {p}" for p in parts)


def convert_command(argv: list[str]) -> int:
    """Run ``qz convert``; return the process exit status."""
    parser = argparse.ArgumentParser(
        prog="qz convert",
        description="Convert Origin projects (.opj/.opju) to CSV, Excel or Quantized "
        "workspaces, every book and sheet, without Origin.",
    )
    parser.add_argument("inputs", nargs="+", help="project files or globs (** recurses)")
    parser.add_argument("--to", required=True, choices=CONVERT_FORMATS, help="output format")
    parser.add_argument("--out", required=True, type=Path, help="output directory")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="also write books the reader could not fully decode (still reported, exit 1)",
    )
    parser.add_argument(
        "--report", type=Path, default=None, help=f"report path (default <out>/{_REPORT_NAME})"
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace output files that already exist (never an input file)",
    )
    args = parser.parse_args(argv)
    paths, unmatched = expand_inputs(args.inputs)
    if not paths:
        print("[qz] convert: no input file matches", " ".join(args.inputs), file=sys.stderr)
        return 2
    report_path = args.report or args.out / _REPORT_NAME
    try:  # the report obeys the outputs' rule, checked before any work is done
        check_target(report_path, overwrite=args.overwrite, protected=paths)
    except WriteRefused as exc:
        print(f"[qz] convert: report {exc} (pass --overwrite to replace it)", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    imported_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    entries: list[dict[str, Any]] = []
    for pattern in unmatched:  # an input that names nothing is a failure, not a no-op
        entries.append(_failed(pattern, "no file matches this input"))
        print(_line(entries[-1]), flush=True)
    for path, prefix in zip(paths, unique_prefixes(paths), strict=True):
        if not path.is_file():
            entry = _failed(str(path), "file not found")
        else:
            entry = convert_origin_project(
                path,
                args.out,
                args.to,
                prefix=prefix,
                allow_partial=args.allow_partial,
                imported_at=imported_at,
                overwrite=args.overwrite,
                protected=paths,
            )
        entries.append(entry)
        print(_line(entry), flush=True)
    counts = {s: sum(e["status"] == s for e in entries) for s in ("ok", "partial", "failed")}
    report = {
        "version": 1,
        "format": args.to,
        "out": str(args.out),
        "summary": counts,
        "files": entries,
    }
    report_path.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(
        f"[qz] convert: {counts['ok']} ok, {counts['partial']} partial, "
        f"{counts['failed']} failed; report: {report_path}"
    )
    return 0 if counts["ok"] == len(entries) else 1
