"""``qz convert`` -- batch-convert data files and Origin projects, no GUI, no Origin.

    qz convert *.opj archive/**/*.opju --to xlsx --out converted/
    qz convert run1.opj --to csv --out out/ --allow-partial
    qz convert scan.nxs fit.mat wave.ibw map.tif --to csv --out out/
    qz convert scan.xrdml rsm.xrdml run.dat            # --to auto, next to each input
    qz convert *.raw --to nxs --guess                  # print the guesses, write nothing
    qz convert --gui scan.xrdml run.dat                # the small window, prefilled
    qz convert --install-context-menu                  # right-click "Convert with Quantized"

``--gui`` opens the quick-convert window alone (no workspace; ``--desktop`` for
a native window): files, output folder (default: next to each input), output
format (default: guessed), an overwrite tick (off). It is what the right-click
entry runs (``convert_context_menu``, opt-in, HKCU only on Windows).

``--to`` is one of csv, xlsx, xy, h5, nxs, mat, json, npz (dwk for Origin
projects) or ``auto`` (the default): the format guessed per input type
(``io/convert_defaults.py``, provisional, owner to confirm). ``--out`` is
optional: each output goes in its input's own folder. ``--guess`` prints what
is guessed for every input (type, datasets, columns, format, output names) as
JSON and writes nothing. Policies (``io/convert_plan.py``): containers (xlsx,
h5/nxs, mat, json, npz) are one file with a sheet/group per dataset, flat
formats (csv, xy) one file per dataset; a 2-D map written flat is a lossless
long table; metadata is a ``#`` header in csv/xy, native attributes in the
containers, a ``metadata`` sheet in Excel (``--no-metadata`` omits the flat
ones).

Any file that is not an Origin project goes through the import registry,
every dataset in it (``io/convert_data.py``).

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

from quantized.io.convert_data import classify_outcome
from quantized.io.convert_defaults import PROVISIONAL
from quantized.io.convert_guess import guess_inputs
from quantized.io.convert_plan import unique_prefixes
from quantized.io.convert_run import REPORT_NAME, build_report, convert_one, failed_entry
from quantized.io.origin_convert import CONVERT_FORMATS
from quantized.io.write_guard import WriteRefused, check_target

__all__ = ["convert_command", "expand_inputs", "unique_prefixes"]  # unique_prefixes: re-export

_REPORT_NAME = REPORT_NAME


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
    if entry.get("outcome") == "skipped-exists":
        parts.append(f"skipped: {entry['reason']}")
    parts += [f"not recovered: {o}" for o in entry["omissions"]]
    parts += [f"note: {n}" for n in entry.get("notes", [])]
    parts += [f"note: {b['book']} sheet {b['sheet']}: {n}" for b in books for n in b["notes"]]
    return f"[{entry['status']:>7}] {entry['source']}" + "".join(f"\n    {p}" for p in parts)


def _context_menu(*, install: bool) -> int:
    """``--install-context-menu`` / ``--uninstall-context-menu``."""
    from quantized import convert_context_menu as cm

    try:
        done = cm.install() if install else cm.uninstall()
    except (cm.UnsupportedPlatformError, OSError) as exc:
        print(f"[qz] convert: {exc}", file=sys.stderr)
        return 2
    verb = "added" if install else "removed"
    if not done:
        print("[qz] convert: no right-click entry was installed; nothing to remove")
    for item in done:
        print(f"[qz] convert: {verb} {item}")
    return 0


def convert_command(argv: list[str]) -> int:
    """Run ``qz convert``; return the process exit status."""
    parser = argparse.ArgumentParser(
        prog="qz convert",
        description="Convert Origin projects (.opj/.opju) to CSV, Excel or Quantized "
        "workspaces, every book and sheet, without Origin. Any other file Quantized "
        "imports (HDF5/NeXus, MATLAB .mat, Igor .ibw, images, instrument files) converts "
        "to CSV or Excel, every dataset in it.",
    )
    parser.add_argument("inputs", nargs="*", help="project or data files, or globs (** recurses)")
    parser.add_argument(
        "--to",
        default="auto",
        choices=(*CONVERT_FORMATS, "auto"),
        help="output format; auto (default) guesses it per input type "
        f"({PROVISIONAL}); dwk is for Origin projects",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output directory (default: each input's own folder)",
    )
    parser.add_argument(
        "--guess",
        action="store_true",
        help="print the guessed type, datasets, columns, format and output names "
        "as JSON; write nothing",
    )
    parser.add_argument(
        "--no-metadata",
        action="store_true",
        help="leave the '#' metadata header (csv/xy) and metadata sheet (xlsx) out",
    )
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
    gui = parser.add_argument_group("quick-convert window (no full app)")
    gui.add_argument(
        "--gui",
        action="store_true",
        help="open the small quick-convert window (browser, or --desktop), prefilled with "
        "the files given; the other options are set in the window",
    )
    gui.add_argument(
        "--desktop", action="store_true", help="with --gui: a native window (pywebview)"
    )
    gui.add_argument(
        "--port", type=int, default=None, help="with --gui: server port (default: a free one)"
    )
    gui.add_argument(
        "--install-context-menu",
        action="store_true",
        help="add a right-click 'Convert with Quantized' entry (Windows: HKCU only, no "
        "admin; Linux: a Nautilus script); nothing else is changed",
    )
    gui.add_argument(
        "--uninstall-context-menu", action="store_true", help="remove that right-click entry"
    )
    args = parser.parse_args(argv)
    if args.install_context_menu or args.uninstall_context_menu:
        return _context_menu(install=args.install_context_menu and not args.uninstall_context_menu)
    if args.gui:
        from quantized.convert_gui_launch import gui_command

        return gui_command(args.inputs, desktop=args.desktop, port=args.port)
    if args.desktop or args.port is not None:
        parser.error("--desktop and --port are for --gui")
    if not args.inputs:
        parser.error("give at least one input file (or --gui to pick them in a window)")
    paths, unmatched = expand_inputs(args.inputs)
    if not paths:
        print("[qz] convert: no input file matches", " ".join(args.inputs), file=sys.stderr)
        return 2
    if args.guess:
        guesses = guess_inputs(paths, out_dir=args.out, fmt=None if args.to == "auto" else args.to)
        print(json.dumps([g.to_dict() for g in guesses], indent=1, ensure_ascii=False))
        return 0 if all(g.error is None for g in guesses) else 1
    report_dir = args.out or paths[0].parent
    report_path = args.report or report_dir / _REPORT_NAME
    try:  # the report obeys the outputs' rule, checked before any work is done
        check_target(report_path, overwrite=args.overwrite, protected=paths)
    except WriteRefused as exc:
        print(f"[qz] convert: report {exc} (pass --overwrite to replace it)", file=sys.stderr)
        return 2
    if args.out is not None:
        args.out.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    imported_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    entries: list[dict[str, Any]] = []
    for pattern in unmatched:  # an input that names nothing is a failure, not a no-op
        entries.append(classify_outcome(failed_entry(pattern, "no file matches this input")))
        print(_line(entries[-1]), flush=True)
    for path, prefix in zip(paths, unique_prefixes(paths), strict=True):
        entry = convert_one(
            path,
            prefix,
            args.out or path.parent,
            args.to,
            metadata=not args.no_metadata,
            allow_partial=args.allow_partial,
            overwrite=args.overwrite,
            protected=paths,
            imported_at=imported_at,
        )
        entries.append(entry)
        print(_line(entry), flush=True)
    report = build_report(entries, args.to, str(args.out) if args.out else None)
    counts = report["summary"]
    report_path.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(
        f"[qz] convert: {counts['ok']} ok, {counts['partial']} partial, "
        f"{counts['failed']} failed; report: {report_path}"
    )
    return 0 if counts["ok"] == len(entries) else 1
