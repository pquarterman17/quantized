"""Build every (family x plot type) specimen in Origin over COM.

For each generated family (``generate.py`` output) and each plot type it can
feed (``plot_types.applicable``): a fresh project, the family's books and
matrices, one graph made with Origin's own menu recipe, known styles applied,
then

    <out>/<type>/<family>/specimen.opju   app.Save (Student writes .opju only)
    <out>/<type>/<family>/specimen.png    expGraph
    <out>/<type>/<family>/oracle.json     read back FROM ORIGIN (origin_oracle)
    <out>/<type>/<family>/<family>.truth.json  copied from the generator

and ``<out>/manifest.json`` with one status row per specimen
(ok | mismatch | refused | timeout | error). A type Student will not
build is recorded as ``refused`` with the reason, never silently skipped.

Process safety lives in ``origin_session``: refuses to start beside another
Origin, kills exactly the PID it started (finally + atexit + job object), and
a per-specimen deadline kills a hung build; the next specimen gets a fresh
instance. Run under the shared COM lock:

    uv run --no-project --with pywin32 --with numpy python \
        tools/plot_corpus/origin_build.py --corpus <generated> --out <dir>
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from origin_oracle import read_book_sheets, read_graph  # noqa: E402
from origin_session import OriginSession  # noqa: E402
from plot_types import PLOT_TYPES, PlotType, applicable  # noqa: E402
from styles import (  # noqa: E402
    LT_DESIGNATION,
    LT_FORMAT,
    STEP_HORIZONTAL_CONNECT,
    STYLED_TYPES,
    curve_style,
)

DEFAULT_TIMEOUT = 180.0


def _q(text: str) -> str:
    """A LabTalk double-quoted string literal (no quotes in corpus names)."""
    if '"' in text:
        raise ValueError(f"quote in LabTalk string: {text!r}")
    return f'"{text}"'


def _num(v: float | None) -> float:
    return math.nan if v is None else float(v)


def build_book(s: OriginSession, book: dict[str, Any]) -> str:
    s.lt(f"newbook name:={_q(book['name'])} sheet:=1 option:=lsname;")
    short = s.lts('"%H"')
    for k, sheet in enumerate(book["sheets"]):
        if k:
            s.lt(f"newsheet name:={_q(sheet['name'])} cols:={len(sheet['columns'])};")
        s.lt(f"page.active = {k + 1};")
        s.lt(f"wks.name$ = {_q(sheet['name'])};")
        s.lt(f"wks.ncols = {len(sheet['columns'])};")
        for ci, col in enumerate(sheet["columns"], start=1):
            s.lt(f"wks.col{ci}.type = {LT_DESIGNATION[col['designation']]};")
            s.lt(f"wks.col{ci}.format = {LT_FORMAT[col['fmt']]};")
            s.lt(f"wks.col{ci}.lname$ = {_q(col['long'])};")
            s.lt(f"wks.col{ci}.unit$ = {_q(col['units'])};")
            if col.get("text") is not None:
                data: list[list[Any]] = [[t] for t in col["text"]]
            else:
                data = [[_num(v)] for v in col["values"]]
            s.app.PutWorksheet(f"[{short}]{sheet['name']}", data, 0, ci - 1)
        for col_short, rows in sheet.get("masked_rows", {}).items():
            ci = 1 + [c["short"] for c in sheet["columns"]].index(col_short)
            for r in rows:
                s.lt(f"mark -w1 [{short}]{sheet['name']}!col({ci})[{r + 1}:{r + 1}];")
    for sheet in book["sheets"]:
        if sheet.get("deleted"):
            s.lt(f"win -a {short}; page.active$ = {_q(sheet['name'])}; layer -d;")
    return short


def build_matrix(s: OriginSession, m: dict[str, Any]) -> str:
    rows, cols = len(m["values"]), len(m["values"][0])
    s.lt(f"newbook name:={_q(m['name'])} mat:=1 option:=lsname;")
    short = s.lts('"%H"')
    s.lt(f"mdim cols:={cols} rows:={rows} x1:={m['x1']} x2:={m['x2']} "
         f"y1:={m['y1']} y2:={m['y2']};")
    s.app.PutMatrix(f"[{short}]1", [[_num(v) for v in r] for r in m["values"]])
    return short


def _selection(ptype: PlotType, columns: list[dict[str, Any]]) -> tuple[int, int]:
    n = len(columns)
    if ptype.select == "y":
        ys = [i + 1 for i, c in enumerate(columns) if c["designation"] == "Y"]
        return ys[0], ys[-1]
    if ptype.shape in ("xyy",):
        return 1, min(3, n)
    return 1, n


def make_graph(s: OriginSession, fam: dict[str, Any], ptype: PlotType,
               books: list[str], mats: list[str]) -> tuple[str | None, str]:
    """Create the graph with Origin's menu recipe; (page or None, detail)."""
    code = "?" if ptype.code is None else str(ptype.code)
    if ptype.select == "matrix":
        s.lt(f"win -a {mats[0]};")
    else:
        sheet = fam["books"][0]["sheets"][0]
        s.lt(f"win -a {books[0]}; page.active$ = {_q(sheet['name'])};")
        c1, c2 = _selection(ptype, sheet["columns"])
        s.lt(f"worksheet -s {c1} 0 {c2} 0;")
    before = s.lts('"%H"')
    ok = s.lt(f"worksheet -p {code} {ptype.template};")
    page = s.lts('"%H"')
    if page == before or s.ltn(f"exist({page}, 3)") != 3:
        return None, f"worksheet -p {code} {ptype.template} made no graph (ok={ok})"
    return page, f"worksheet -p {code} {ptype.template} (ok={ok})"


def style_graph(
    s: OriginSession, page: str, ptype: PlotType, fam: dict[str, Any]
) -> list[dict[str, Any]]:
    """Apply the corpus's known styles; returns what was REQUESTED (the oracle
    records what Origin then reports)."""
    requested: list[dict[str, Any]] = []
    s.lt(f"win -a {page}; page.active = 1;")
    n = int(s.ltn(f'qz_nplots("{page}", 0)') or 0)
    if ptype.name in STYLED_TYPES:
        for pi in range(n):
            st = curve_style(ptype.name, pi)
            s.lt(f"layer.plot = {pi + 1};")
            for opt, val in st.items():
                s.lt(f"set %C -{opt} {val};")
            if ptype.name == "step_horizontal":
                s.lt(f"layer.plot{pi + 1}.line.connect = {STEP_HORIZONTAL_CONNECT};")
                st = {**st, "line.connect": STEP_HORIZONTAL_CONNECT}
            requested.append(st)
    for ax, scale in fam.get("axis", {}).items():
        if scale == "log10":
            s.lt(f"layer.{ax}.type = 2;")  # measured: 1 linear (default), 2 log10
    s.lt("layer -a;")
    return requested


def build_one(s: OriginSession, fam: dict[str, Any], ptype: PlotType, dest: Path) -> dict[str, Any]:
    s.app.NewProject()
    books = [build_book(s, b) for b in fam["books"]]
    mats = [build_matrix(s, m) for m in fam["matrices"]]
    page, detail = make_graph(s, fam, ptype, books, mats)
    row: dict[str, Any] = {"recipe": detail, "books": books, "matrices": mats}
    if page is None:
        return {**row, "status": "refused", "reason": detail}
    s.lt(f"page.longname$ = {_q(fam['name'] + ' / ' + ptype.name)};")
    row["requested_styles"] = style_graph(s, page, ptype, fam)
    graph = read_graph(s, page)
    got = [p["plot_type"] for lay in graph["layers"] for p in lay["plots"]]
    row["graph"] = graph
    row["book_readback"] = [read_book_sheets(s, b) for b in books]
    dest.mkdir(parents=True, exist_ok=True)
    s.lt(f"win -a {page};")
    fwd = str(dest.resolve()).replace("\\", "/")
    s.lt(f'expGraph type:=png path:="{fwd}" filename:="specimen" overwrite:=replace;')
    row["saved"] = bool(s.app.Save(str((dest / "specimen.opju").resolve())))
    row["png"] = (dest / "specimen.png").exists()
    allowed = ptype.expected_readback()
    if not got:
        row["status"], row["reason"] = "refused", "graph has no data plots"
    elif allowed and not set(got) <= allowed:
        row["status"] = "mismatch"
        row["reason"] = f"expected {sorted(allowed)}, Origin reports {sorted(set(got))}"
    else:
        row["status"] = "ok"
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", type=Path, required=True, help="generate.py --out dir")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--family", action="append")
    ap.add_argument("--type", action="append", choices=[p.name for p in PLOT_TYPES])
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    manifest: dict[str, Any] = (
        json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    )
    fam_dirs = sorted(d for d in args.corpus.iterdir() if (d / "family.json").exists())
    jobs = []
    for d in fam_dirs:
        if args.family and d.name not in args.family:
            continue
        fam = json.loads((d / "family.json").read_text(encoding="utf-8"))
        truth = json.loads((d / f"{d.name}.truth.json").read_text(encoding="utf-8"))
        for ptype in applicable(frozenset(truth["shapes"])):
            if not args.type or ptype.name in args.type:
                jobs.append((d, fam, ptype))
    session: OriginSession | None = None
    try:
        for d, fam, ptype in jobs:
            key = f"{ptype.name}/{d.name}"
            dest = args.out / ptype.name / d.name
            if session is None:
                session = OriginSession(args.out / "origin.pid").start()
                if not session.load_oc(HERE / "qz_oracle.c", args.out / "_oc"):
                    raise RuntimeError("qz_oracle.c failed to compile")
            t0 = time.monotonic()
            try:
                with session.deadline(args.timeout):
                    row = build_one(session, fam, ptype, dest)
            except Exception as exc:  # noqa: BLE001 - record and continue
                timed_out = session.timed_out
                session.close()
                session = None
                row = {"status": "timeout" if timed_out else "error", "reason": repr(exc)[:300]}
            row["seconds"] = round(time.monotonic() - t0, 2)
            row["family"], row["type"] = d.name, ptype.name
            if row["status"] not in ("timeout", "error"):
                dest.mkdir(parents=True, exist_ok=True)
                shutil.copy(d / f"{d.name}.truth.json", dest / f"{d.name}.truth.json")
                (dest / "oracle.json").write_text(
                    json.dumps(row, indent=1, ensure_ascii=False, default=str), encoding="utf-8"
                )
            manifest[key] = {k: row.get(k) for k in ("status", "reason", "seconds", "recipe")}
            manifest_path.write_text(
                json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8"
            )
            print(f"{key}: {row['status']} {row.get('reason', '')}", flush=True)
    finally:
        if session is not None:
            session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
