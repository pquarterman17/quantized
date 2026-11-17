"""Plan item 9, step 3: score Origin's readback of every round-trip export.

Reads ``<dir>/exports/index.json`` (``roundtrip_run.py``) and each export's
``readback.json`` (``roundtrip_origin.py``), scores them against the
specimen's planted sheet and Origin's own ``oracle.json``
(``roundtrip_compare``), and writes ``<dir>/scorecard.json`` +
``<dir>/scorecard.md``: per path x dimension totals, per path x plot type and
path x family worst verdicts, and every WRONG value first, grouped by reason.
No Origin is needed.

    uv run python tools/plot_corpus/score_roundtrip.py --dir <dir> --corpus <corpus> --gen <gen>
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from roundtrip_compare import DIMS, Tally, score_book, score_graph, score_shipped  # noqa: E402
from scratch_data import graph_columns  # noqa: E402

PATHS = ("ogs", "opj", "project", "com")
GRAPH_PATHS = {"ogs"}  # the only path whose request carries a graph
PATH_LABEL = {
    "ogs": "Export Origin (.ogs)",
    "opj": "Export Origin project (.opj)",
    "project": "/api/export/origin-project (API only)",
    "com": "Send to Origin (COM)",
}
ORDER = ("wrong", "phantom", "missing", "match")


def _cols_by_book(books: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for b in books:
        for sh in b.get("sheets", []):
            for c in sh.get("columns", []):
                out.setdefault(b["book"], {}).setdefault(c["short"], c.get("long") or c["short"])
    return out


def _oracle_cols(fam: dict[str, Any], oracle: dict[str, Any]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for bi, b in enumerate(fam.get("books", [])):
        name = (
            (oracle.get("books") or [b["name"]])[bi]
            if bi < len(oracle.get("books") or [])
            else b["name"]
        )
        for sh in b["sheets"]:
            for c in sh["columns"]:
                out.setdefault(name, {}).setdefault(c["short"], c["long"])
    return out


def score_export(
    key: str,
    path: str,
    rb: dict[str, Any],
    fam: dict[str, Any],
    oracle: dict[str, Any],
    script: str = "",
) -> dict[str, Any]:
    t = Tally()
    truth = graph_columns(fam)
    if not rb.get("opened"):
        t.add("values", "missing", f"Origin did not open it: {rb.get('reason', '')}", len(truth))
    else:
        score_book(t, truth, rb.get("books", []), key.replace("/", "_"))
        if path in GRAPH_PATHS:
            n = max(len(c["text"] if c.get("text") is not None else c["values"]) for c in truth)
            score_shipped(t, rb.get("shipped"), n)
        score_graph(
            t,
            oracle.get("graph", {}),
            _oracle_cols(fam, oracle),
            rb.get("graphs", []),
            _cols_by_book(rb.get("books", [])),
            graph_path=path in GRAPH_PATHS,
            script=script,
        )
    if fam.get("books") and fam["books"][0]["sheets"][0].get("masked_rows"):
        t.add("row_mask", "missing", "no export path carries a row mask")
    ptype, family = key.split("/")
    return {
        "key": key,
        "type": ptype,
        "family": family,
        "path": path,
        "failed_lines": rb.get("failed_lines", []),
        "dims": t.to_json(),
    }


def worst(cell: dict[str, Any] | None) -> str:
    if not cell:
        return "-"
    for v in ORDER:
        if cell.get(v):
            return v
    return "-"


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    totals: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: dict.fromkeys(ORDER, 0))
    )
    by_type: dict[tuple[str, str], dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    by_fam: dict[tuple[str, str], dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    wrongs: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for r in rows:
        for dim, cell in r["dims"].items():
            for v in ORDER:
                totals[r["path"]][dim][v] += cell.get(v, 0)
            by_type[(r["path"], r["type"])][dim].add(worst(cell))
            by_fam[(r["path"], r["family"])][dim].add(worst(cell))
            for verdict in ("wrong", "phantom"):
                for why in cell.get("why", {}).get(verdict, []):
                    wrongs[(r["path"], dim, f"{verdict}: {_shape(why)}")].append(r["key"])

    def collapse(d: dict[tuple[str, str], dict[str, set[str]]]) -> dict[str, dict[str, str]]:
        return {
            f"{p}|{k}": {dim: next((v for v in ORDER if v in vs), "-") for dim, vs in cells.items()}
            for (p, k), cells in d.items()
        }

    return {
        "totals": {p: dict(d) for p, d in totals.items()},
        "by_type": collapse(by_type),
        "by_family": collapse(by_fam),
        "wrong": [
            {"path": p, "dim": dim, "reason": why, "n": len(keys), "keys": sorted(set(keys))[:12]}
            for (p, dim, why), keys in sorted(wrongs.items(), key=lambda kv: -len(kv[1]))
        ],
    }


def _shape(why: str) -> str:
    """A reason with its specimen-specific numbers kept but quoted names dropped,
    so the same defect on different columns groups together."""
    import re

    return re.sub(r"'[^']*'", "'…'", why)


def markdown(summary: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    out = ["# Round trip quantized -> Origin (plan item 9)", ""]
    keys = sorted({r["key"] for r in rows})
    out += [
        f"{len(keys)} check-2 matches x {len(PATHS)} paths = {len(rows)} exports opened in Origin.",
        "",
    ]
    out += ["## WRONG / phantom values Origin reads back (exporter defects)", ""]
    if not summary["wrong"]:
        out.append("None.")
    for w in summary["wrong"]:
        eg = ", ".join(w["keys"][:4])
        out.append(f"- **{w['path']} / {w['dim']}** x{w['n']} -- {w['reason']} (e.g. {eg})")
    out += ["", "## Totals per path x dimension (match / wrong / phantom / missing)", ""]
    out.append("| path | " + " | ".join(DIMS) + " |")
    out.append("|---|" + "---|" * len(DIMS))
    for p in PATHS:
        t = summary["totals"].get(p, {})
        cells = []
        for dim in DIMS:
            c = t.get(dim)
            cells.append(
                "-" if not c else f"{c['match']}/{c['wrong']}/{c['phantom']}/{c['missing']}"
            )
        out.append(f"| {PATH_LABEL[p]} | " + " | ".join(cells) + " |")
    for title, table in (("plot type", summary["by_type"]), ("family", summary["by_family"])):
        out += ["", f"## Worst verdict per path x {title}", ""]
        out.append(f"| path | {title} | " + " | ".join(DIMS) + " |")
        out.append("|---|---|" + "---|" * len(DIMS))
        for k in sorted(table):
            p, name = k.split("|")
            out.append(f"| {p} | {name} | " + " | ".join(table[k].get(d, "-") for d in DIMS) + " |")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=Path, required=True)
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--gen", type=Path, required=True)
    args = ap.parse_args(argv)
    exports = args.dir / "exports"
    index = json.loads((exports / "index.json").read_text(encoding="utf-8"))
    rows = []
    for key, entry in sorted(index.items()):
        if entry["check2"] != "match":
            continue
        ptype, family = key.split("/")
        fam = json.loads((args.gen / family / "family.json").read_text(encoding="utf-8"))
        oracle = json.loads(
            (args.corpus / ptype / family / "oracle.json").read_text(encoding="utf-8")
        )
        for path, info in entry["paths"].items():
            folder = exports / info["id"]
            rbf = folder / "readback.json"
            rb = (
                json.loads(rbf.read_text(encoding="utf-8"))
                if rbf.exists()
                else {"opened": False, "reason": "not read back"}
            )
            script = "".join(f.read_text(encoding="utf-8") for f in folder.glob("*.ogs"))
            rows.append(score_export(key, path, rb, fam, oracle, script))
    summary = summarise(rows)
    (args.dir / "scorecard.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    (args.dir / "scorecard.md").write_text(markdown(summary, rows), encoding="utf-8")
    print(f"{len(rows)} exports scored -> {args.dir / 'scorecard.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
