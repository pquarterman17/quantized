"""Freeze OriginPro's own answers for analysis functions as test fixtures.

    uv run --with pywin32 python tools/origin_oracle/run.py --all
    uv run --with pywin32 python tools/origin_oracle/run.py --case intersect
    uv run python tools/origin_oracle/run.py --list      # no Origin needed

Safety (see README.md): one owned ``Origin.Application`` instance via
``tools/plot_corpus/origin_session.py`` (never ``ApplicationSI``); refuses to
start beside an Origin it did not start; every case runs under a 60 s
deadline; a hang kills only the owned PID and the run continues on a new
instance. ``input.csv`` / ``truth.json`` are written before Origin is touched
and are byte-deterministic; ``oracle.json`` is Origin's answer and is always
written, with a status that is never "ok" unless every step returned True.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
for p in (HERE, ROOT / "tools" / "plot_corpus", ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from oracle_cases import CASES  # noqa: E402
from oracle_model import Case, InputSpec, find_case, make_input  # noqa: E402
from oracle_store import case_dir, corpus_root, write_inputs, write_oracle  # noqa: E402

DEADLINE_S = 60.0


def _q(text: str) -> str:
    return '"' + text.replace('"', "'") + '"'


def build_input_book(s: Any, spec: InputSpec) -> str:
    """A fresh book holding the case input; returns its short name."""
    from styles import LT_DESIGNATION  # plot_corpus: derived from the writer table

    s.lt("newbook name:=OracleIn option:=lsname;")
    book = s.lts('"%H"')
    s.lt("page.active = 1;")
    s.lt(f"wks.ncols = {len(spec.columns)};")
    for i, col in enumerate(spec.columns, start=1):
        s.lt(f"wks.col{i}.type = {LT_DESIGNATION[col.designation]};")
        s.lt(f"wks.col{i}.lname$ = {_q(col.name)};")
        s.app.PutWorksheet(f"[{book}]1", [[float(v)] for v in col.values], 0, i - 1)
    s.lt(f"win -a {book};")
    s.lt("page.active = 1;")
    return str(book)


def _read_scalar(s: Any, name: str, kind: str) -> Any:
    if kind == "str":
        return str(s.app.LTStr(name + "$"))
    return float(s.app.LTVar(name))


def run_case(s: Any, case: Case, spec: InputSpec) -> dict[str, Any]:
    """Drive one case on an open session; returns the oracle.json document."""
    from roundtrip_origin import read_books

    before = {b["book"] for b in read_books(s)}
    doc: dict[str, Any] = {
        "case": case.id,
        "status": "failed",
        "origin_version": s.ltn("@V"),
        "date": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d"),
        "labtalk": [],
        "step_results": [],
        "values": {},
        "books": [],
        "error": None,
    }
    book = build_input_book(s, spec)
    for src in case.load_oc:
        if not s.load_oc(HERE / src, Path(tempfile.gettempdir()) / "origin_oracle_oc"):
            doc["error"] = f"run.LoadOC failed for {src}"
            return doc
    doc["labtalk"] = case.labtalk(book)
    ok = True
    for lt in doc["labtalk"]:
        res = s.lt(lt)
        doc["step_results"].append(res)
        if not res:
            ok = False
            doc["error"] = f"Execute returned False: {lt}"
            break
    for r in case.reads:
        try:
            doc["values"][r.name] = _read_scalar(s, r.name, r.kind)
        except Exception as exc:  # noqa: BLE001 - recorded, not hidden
            doc["values"][r.name] = None
            doc["error"] = doc["error"] or f"read {r.name}: {exc}"
            ok = False
    created = [b for b in read_books(s) if b["book"] not in before]
    for b in created:
        if b["book"] == book:  # input.csv already holds the input columns
            first = b["sheets"][0]
            first["columns"] = first["columns"][len(spec.columns):]
            if not first["columns"]:
                b["sheets"] = b["sheets"][1:]
    doc["books"] = [b for b in created if b["sheets"]]
    doc["status"] = "ok" if ok else "failed"
    for b in created:
        s.lt(f"win -cd {b['book']};")
    doc["leftover_books"] = sorted({b["book"] for b in read_books(s)} - before)
    return doc


def exercise(cases: list[Case], out_root: Path, sidecar: Path) -> dict[str, str]:
    """Run ``cases``; returns {case id: status}."""
    from origin_session import OriginSession, assert_no_origin

    results: dict[str, str] = {}
    live = [c for c in cases if not c.not_exercised]
    if live:
        assert_no_origin()
    sess: Any = None
    try:
        for case in cases:
            directory = case_dir(out_root, case.id)
            spec = make_input(case)
            write_inputs(directory, case, spec)
            base = {"case": case.id, "date": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d")}
            if case.not_exercised:
                write_oracle(directory, {**base, "status": "not_exercised",
                                         "tried": list(case.not_exercised)})
                results[case.id] = "not_exercised"
                continue
            if sess is None:
                sess = OriginSession(sidecar).start()
            doc: dict[str, Any]
            try:
                with sess.deadline(DEADLINE_S):
                    doc = run_case(sess, case, spec)
            except Exception as exc:  # noqa: BLE001
                doc = {**base, "status": "timeout" if sess.timed_out else "failed",
                       "labtalk": case.labtalk("<book>"), "error": repr(exc)}
            if sess.timed_out:
                doc["status"] = "timeout"
                sess.close()
                sess = None
            write_oracle(directory, doc)
            results[case.id] = str(doc["status"])
            print(f"{results[case.id]:14} {case.id}", flush=True)
    finally:
        if sess is not None:
            sess.close()
    return results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--case", action="append", help="case id (repeatable)")
    g.add_argument("--all", action="store_true")
    g.add_argument("--list", action="store_true")
    ap.add_argument("--out", type=Path, help="corpus root (default: test-data)")
    args = ap.parse_args(argv)
    if args.list:
        for c in CASES:
            print(f"{c.id:16} seed={c.seed} {'NOT EXERCISED' if c.not_exercised else ''}"
                  f" {c.description}")
        return 0
    cases = list(CASES) if args.all else [find_case(CASES, i) for i in args.case]
    out_root = args.out or corpus_root()
    sidecar = Path(tempfile.gettempdir()) / "origin_oracle_owned.json"
    results = exercise(cases, out_root, sidecar)
    bad = [k for k, v in results.items() if v not in ("ok", "not_exercised")]
    print(f"{len(results) - len(bad)} ok/not-exercised, {len(bad)} failed: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
