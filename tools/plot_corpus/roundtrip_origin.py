"""Plan item 9, step 2: open every round-trip export in Origin and read it back.

For each export ``roundtrip_run.py`` wrote under ``<dir>/exports/<id>/``, a
fresh project in ONE owned ``Origin.Application`` (``origin_session``; never
``ApplicationSI``) opens it the way a user would:

* ``ogs`` / ``project`` -- ``cd`` to the export folder (the script's
  ``impASC`` names its CSV relative to it), then ``run.file`` the ``.ogs``;
* ``opj`` -- ``Application.Load`` of the ``.opj``;
* ``com`` -- the app's own ``io.origin_com.send_to_origin`` with the saved
  request body, its dispatch of the user's Origin (the SI ProgID) answered with
  THIS session's ``Origin.Application`` (so the owner's Origin is never
  touched, and the LabTalk / ``PutWorksheet`` calls are the shipped ones).

Then reads back what Origin holds -- every workbook's columns (short name,
``wks.col.type``, long name, unit, comment, values via ``GetWorksheet``) and
every graph through the harness's own reader (``origin_oracle.read_graph``:
``GetPlotType`` via ``qz_oracle.c``, ``%Z``, refs, axes, styles) -- into
``<dir>/exports/<id>/readback.json``. Run under the shared COM lock:

    uv run --with pywin32 python tools/plot_corpus/roundtrip_origin.py --dir <dir>
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from origin_oracle import read_graph  # noqa: E402
from origin_session import OriginSession  # noqa: E402

DEFAULT_TIMEOUT = 180.0


def _windows(s: OriginSession, kind: str) -> list[str]:
    s.lt('string __acc$ = "";')
    s.lt(f'doc -e {kind} {{ __acc$ = "%(__acc$)%H|"; }}')
    return [w for w in str(s.app.LTStr("__acc$")).split("|") if w]


def _cell(v: Any) -> Any:
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def read_books(s: OriginSession) -> list[dict[str, Any]]:
    books = []
    for book in _windows(s, "W"):
        s.lt(f"win -a {book};")
        info: dict[str, Any] = {"book": book, "long_name": s.lts("page.longname$"), "sheets": []}
        n_sheets = int(s.ltn("page.nlayers") or 0)
        for si in range(1, n_sheets + 1):
            s.lt(f"page.active = {si};")
            sheet = s.lts("wks.name$")
            ncols = int(s.ltn("wks.ncols") or 0)
            cols = []
            for j in range(1, ncols + 1):
                cols.append(
                    {
                        "short": s.lts(f"wks.col{j}.name$"),
                        "type": s.ltn(f"wks.col{j}.type"),
                        "long": s.lts(f"wks.col{j}.lname$"),
                        "unit": s.lts(f"wks.col{j}.unit$"),
                        "comment": s.lts(f"wks.col{j}.comment$"),
                    }
                )
            raw = s.app.GetWorksheet(f"[{book}]{sheet}") if ncols else None
            rows = [list(r) for r in raw] if raw else []
            while rows and all(_cell(v) in (None, "") for v in rows[-1]):
                rows.pop()  # GetWorksheet pads to the sheet's allocated rows
            for j, col in enumerate(cols):
                col["values"] = [_cell(r[j]) if j < len(r) else None for r in rows]
            info["sheets"].append({"name": sheet, "nrows": len(rows), "columns": cols})
        books.append(info)
    return books


_IMPASC = re.compile(r'impASC fname:="([^"\\/:]+)";')


def _book_rows(s: OriginSession) -> list[int]:
    out = []
    for book in _windows(s, "W"):
        s.lt(f"win -a {book};")
        out.append(int(s.ltn("wks.maxrows") or 0))
    return out


def _run_ogs(s: OriginSession, folder: Path) -> dict[str, Any]:
    """Run the script twice. As shipped first (``cd`` to its folder; measured
    2026-11-16: a relative ``impASC fname`` resolves against neither ``cd``
    nor the script's folder, so this imports nothing), recording the row
    counts; then a copy whose CSV names are made absolute, which is what the
    rest of the round trip scores. ``run.file`` needs a BACKSLASH path."""
    ogs = sorted(folder.glob("*.ogs"))
    if len(ogs) != 1:
        return {"opened": False, "reason": f"{len(ogs)} .ogs files"}
    s.lt(f'cd "{folder.resolve()}";')
    shipped_ok = s.lt(f'run.file("{ogs[0].resolve()}");')
    shipped = {"run_ok": shipped_ok, "rows": _book_rows(s)}
    s.app.NewProject()
    text = ogs[0].read_text(encoding="utf-8")
    fixed = _IMPASC.sub(lambda m: f'impASC fname:="{(folder / m.group(1)).resolve()}";', text)
    abs_ogs = folder / "_abs_csv.ogs.txt"
    abs_ogs.write_text(fixed, encoding="utf-8")
    ok = s.lt(f'run.file("{abs_ogs.resolve()}");')
    abs_ogs.unlink(missing_ok=True)
    row: dict[str, Any] = {
        "opened": True,
        "run_ok": ok,
        "shipped": shipped,
        "csv_path_substituted": fixed != text,
    }
    if not ok:
        row["_diagnose"] = fixed  # read_back names the failing lines after the readback
    return row


def _failed_lines(s: OriginSession, script: str) -> list[str]:
    """Re-run ``script`` line by line on a fresh project: the lines Origin rejects."""
    s.app.NewProject()
    return [
        line.strip()
        for line in script.splitlines()
        if line.strip() and not line.lstrip().startswith("//") and not s.lt(line)
    ]


def _run_opj(s: OriginSession, folder: Path) -> dict[str, Any]:
    return {"opened": bool(s.app.Load(str((folder / "export.opj").resolve())))}


def _run_com(s: OriginSession, folder: Path) -> dict[str, Any]:
    from unittest import mock

    import win32com.client

    from quantized.datastruct import DataStruct
    from quantized.io import origin_com

    body = json.loads((folder / "com_body.json").read_text(encoding="utf-8"))
    items = [DataStruct.from_dict(d["dataset"]) for d in body["datasets"]]
    names = [d.get("name", "") for d in body["datasets"]]
    asked: list[str] = []

    def dispatch(progid: str) -> Any:
        asked.append(progid)
        return s.app  # this session's Origin.Application, never the owner's

    with (
        mock.patch.object(origin_com, "com_available", return_value=True),
        mock.patch.object(win32com.client.gencache, "EnsureDispatch", dispatch),
    ):
        try:
            result = origin_com.send_to_origin(items, book_names=names)
        except RuntimeError as exc:
            return {"opened": False, "reason": str(exc)[:300], "dispatch": asked}
    return {"opened": True, "result": result, "dispatch": asked}


OPENERS = {"ogs": _run_ogs, "project": _run_ogs, "opj": _run_opj, "com": _run_com}


def read_back(s: OriginSession, path: str, folder: Path) -> dict[str, Any]:
    s.app.NewProject()
    row = OPENERS[path](s, folder)
    row["books"] = read_books(s)
    pages = _windows(s, "P")
    # impASC adds a hidden sparkline graph per column; they are not the export's graph.
    row["sparklines"] = sum(1 for g in pages if g.lower().startswith("sparkline"))
    row["graphs"] = [read_graph(s, g) for g in pages if not g.lower().startswith("sparkline")]
    row["matrices"] = _windows(s, "M")
    script = row.pop("_diagnose", None)
    if script is not None:
        row["failed_lines"] = _failed_lines(s, script)
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=Path, required=True, help="roundtrip_run.py --out dir")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    ap.add_argument("--redo", action="store_true", help="re-read exports already read back")
    args = ap.parse_args(argv)
    exports = args.dir / "exports"
    todo = sorted(
        d
        for d in exports.iterdir()
        if d.is_dir() and (args.redo or not (d / "readback.json").exists())
    )
    session: OriginSession | None = None
    try:
        for folder in todo:
            path = folder.name.split("_", 1)[0]
            if session is None:
                session = OriginSession(args.dir / "origin.pid").start()
                if not session.load_oc(HERE / "qz_oracle.c", args.dir / "_oc"):
                    raise RuntimeError("qz_oracle.c failed to compile")
            t0 = time.monotonic()
            try:
                with session.deadline(args.timeout):
                    row = read_back(session, path, folder)
            except Exception as exc:  # noqa: BLE001 - record and continue on a fresh Origin
                timed_out = session.timed_out
                session.close()
                session = None
                row = {
                    "opened": False,
                    "reason": ("timeout " if timed_out else "") + repr(exc)[:300],
                }
            row["seconds"] = round(time.monotonic() - t0, 2)
            (folder / "readback.json").write_text(
                json.dumps(row, ensure_ascii=False, default=str), encoding="utf-8"
            )
            print(
                f"{folder.name}: opened={row.get('opened')} books={len(row.get('books', []))} "
                f"graphs={len(row.get('graphs', []))} {row.get('reason', '')}",
                flush=True,
            )
    finally:
        if session is not None:
            session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
