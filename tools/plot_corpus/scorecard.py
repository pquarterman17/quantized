"""Combined scorecard: check 1 (Origin -> quantized import) + check 2 (from scratch).

Plan item 4 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. Merges the two
scorers' JSON into one row per (plot type x family) specimen:

* check 1 -- per dimension (curves / plot type / axes / styles / labels, plus
  the planted values) the WORST verdict of the specimen's cells, ordered
  wrong > phantom > omitted > match, with the cell counts kept beside it;
* check 2 -- buildable? and does the from-scratch figure match Origin's?;
* ``owners`` -- the plan item that owns each gap (``OWNER_*`` tables below).

No Origin needed: it reads ``score_import.py``'s ``scorecard.json`` and
``scratch_run.py``'s ``scorecard.json``. Page / images: ``scorecard_page.py``.

    uv run python tools/plot_corpus/scorecard.py --import-scorecard <c1.json> \\
        --scratch-scorecard <c2.json> --corpus <corpus> --scratch-review <dir> \\
        --out <dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_report import iter_verdicts  # noqa: E402

__all__ = ["DIMENSIONS", "merge", "owners_for", "summarize", "to_markdown", "worst"]

# check-1 dimension -> the score_report check names folded into it.
DIMENSIONS: dict[str, tuple[str, ...]] = {
    "curves": ("curves",),
    "plot_type": ("plot_type",),
    "axes": ("axes",),
    "styles": ("styles", "error_bars"),
    "labels": ("column_meta",),
    "values": ("values",),
}
_ORDER = ("wrong", "phantom", "omitted", "match")
_SHOW = ("match", "wrong", "phantom", "omitted")

# Which plan item owns a type's import gaps (items 5 / 6 / 7).
_XY = {"line", "scatter", "line_symbol", "step_horizontal", "area", "stacked_area", "double_y",
       "y_error"}
_CATEGORY = {"column", "bar", "stacked_column", "stacked_bar", "floating_column", "histogram",
             "box", "violin", "strip"}
# Check-2 creation gaps (cloud items 10-19), by plot type.
_CREATION = {"bar": "#10", "stacked_bar": "#11", "floating_column": "#12", "stacked_area": "#13",
             "column": "#14", "stacked_column": "#14", "histogram": "#15", "double_y": "#16",
             "ternary": "#17", "bubble": "#18", "polar": "#19"}


def worst(statuses: Iterable[str]) -> str:
    """wrong > phantom > omitted > match; ``n/a`` when there is nothing to score."""
    seen = set(statuses)
    return next((s for s in _ORDER if s in seen), "n/a")


def _group_item(ptype: str) -> str:
    if ptype in _XY:
        return "#5"
    return "#6" if ptype in _CATEGORY else "#7"


def owners_for(ptype: str, dim: str, status: str, reasons: Iterable[str]) -> list[str]:
    """Plan items owning a non-match check-1 dimension (empty for a match)."""
    if status in ("match", "n/a"):
        return []
    base = _group_item(ptype)
    out = {base}
    rs = " ".join(reasons)
    if dim == "styles" and "no_field_in_OriginCurve" in rs:
        out.add("#5")  # no dash field / style mapping
    if dim == "plot_type" and ptype in _CATEGORY | {"area", "stacked_area", "step_horizontal"}:
        out.add("#6" if ptype in _CATEGORY else "#5")
    if "text_x" in rs or "x_not_a_column" in rs:
        out.add("#6")
    if ptype in {"bubble", "color_mapped", "polar", "stacked_lines_offset", "contour_xyz",
                 "contour_matrix", "heatmap_matrix", "ternary"}:
        out = {"#7"}
    return sorted(out)


def _dimension(spec: Mapping[str, Any], checks: Sequence[str]) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    reasons: Counter[str] = Counter()
    for check, _where, v in iter_verdicts(spec):
        # a wrong/phantom drawn view is a curves defect; drawn omissions are not
        if check == "drawn" and "curves" in checks and v["status"] in ("wrong", "phantom"):
            pass
        elif check not in checks:
            continue
        counts[v["status"]] += 1
        if v["status"] == "omitted" and v.get("reason"):
            reasons[str(v["reason"])] += 1
    return {"verdict": worst(counts), "counts": dict(counts), "reasons": dict(reasons)}


def _check1(spec: Mapping[str, Any]) -> dict[str, Any]:
    if spec.get("status") != "scored":
        return {"status": spec.get("status", "missing"), "reason": spec.get("reason"), "dims": {}}
    return {"status": "scored", "dims": {d: _dimension(spec, c) for d, c in DIMENSIONS.items()}}


def _check2(row: Mapping[str, Any] | None) -> dict[str, Any]:
    if row is None:
        return {"built": "missing", "verdict": "missing"}
    failed = {k: c.get("why", "") for k, c in (row.get("checks") or {}).items()
              if c.get("state") == "wrong"}
    return {"built": row["built"], "verdict": row["verdict"], "why": row.get("why", ""),
            "wrong": failed, "png": row.get("png"), "origin_png": row.get("origin_png")}


def merge(
    import_specimens: Sequence[Mapping[str, Any]], scratch_rows: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One merged row per (type x family), sorted by type then family."""
    c2 = {r["key"]: r for r in scratch_rows}
    keys = {f"{s['type']}/{s['family']}": s for s in import_specimens}
    out = []
    for key in sorted(set(keys) | set(c2)):
        ptype, family = key.split("/", 1)
        spec = keys.get(key)
        one = _check1(spec) if spec is not None else {"status": "missing", "dims": {}}
        two = _check2(c2.get(key))
        owners: dict[str, list[str]] = {}
        for dim, d in one["dims"].items():
            o = owners_for(ptype, dim, d["verdict"], d["reasons"])
            if o:
                owners[f"import.{dim}"] = o
        if two["built"] == "unbuildable" or two["verdict"] == "mismatch":
            owners["scratch"] = [_CREATION.get(ptype, "unowned")]
        out.append({"key": key, "type": ptype, "family": family, "import": one,
                    "scratch": two, "owners": owners})
    return out


def summarize(rows: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per plot type: check-1 specimen counts by verdict, check-2 buildable / match."""
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        t = out.setdefault(r["type"], {"specimens": 0, "import": {}, "built": 0, "match": 0,
                                       "unbuildable": 0, "no_import": 0})
        t["specimens"] += 1
        if r["import"]["status"] != "scored":
            t["no_import"] += 1
        for dim, d in r["import"]["dims"].items():
            t["import"].setdefault(dim, Counter())[d["verdict"]] += 1
        t["built"] += r["scratch"]["built"] == "built"
        t["unbuildable"] += r["scratch"]["built"] == "unbuildable"
        t["match"] += r["scratch"]["verdict"] == "match"
    for t in out.values():
        t["import"] = {d: dict(c) for d, c in t["import"].items()}
    return out


_ABBR = {"match": "M", "wrong": "W", "phantom": "P", "omitted": "O", "n/a": "-"}


def to_markdown(rows: Sequence[Mapping[str, Any]]) -> str:
    summ = summarize(rows)
    dims = list(DIMENSIONS)
    head = ("| type | specimens | " + " | ".join(dims)
            + " | built | match | unbuildable |")
    lines = [
        "# Combined plot-corpus scorecard",
        "",
        f"{len(rows)} specimens (type x family). Check 1 = Origin -> quantized import, one "
        "verdict per dimension per specimen (worst cell: wrong > phantom > omitted > match); "
        "cells below are specimen counts `match/wrong/phantom/omitted`. Check 2 = built from "
        "scratch in quantized: `built` / `match` / `unbuildable` are specimen counts.",
        "",
        "## Per plot type",
        "",
        head,
        "|" + "---|" * (len(dims) + 5),
    ]
    tot: dict[str, Counter[str]] = {d: Counter() for d in dims}
    sums = Counter()
    for ptype, t in sorted(summ.items()):
        cells = []
        for d in dims:
            c = t["import"].get(d, {})
            tot[d].update(c)
            cells.append("/".join(str(c.get(s, 0)) for s in _SHOW))
        sums.update(specimens=t["specimens"], built=t["built"], match=t["match"],
                    unbuildable=t["unbuildable"])
        lines.append(f"| {ptype} | {t['specimens']} | " + " | ".join(cells)
                     + f" | {t['built']} | {t['match']} | {t['unbuildable']} |")
    lines.append(
        f"| **total** | {sums['specimens']} | "
        + " | ".join("/".join(str(tot[d].get(s, 0)) for s in _SHOW) for d in dims)
        + f" | {sums['built']} | {sums['match']} | {sums['unbuildable']} |")
    lines += ["", "## Per specimen (type x family)", "",
              "Check 1 letters: " + " ".join(f"{a}={s}" for s, a in _ABBR.items())
              + f"; order {' / '.join(dims)}.", "",
              "| specimen | check 1 | check 2 | owner |", "|---|---|---|---|"]
    for r in rows:
        c1 = (r["import"]["status"] if r["import"]["status"] != "scored" else " ".join(
            _ABBR[r["import"]["dims"][d]["verdict"]] for d in dims))
        s = r["scratch"]
        c2 = s["verdict"] if s["built"] != "built" else f"built, {s['verdict']}"
        own = sorted({o for v in r["owners"].values() for o in v})
        lines.append(f"| {r['key']} | {c1} | {c2} | {', '.join(own) or '-'} |")
    return "\n".join(lines) + "\n"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--import-scorecard", type=Path, required=True, help="score_import.py JSON")
    ap.add_argument("--scratch-scorecard", type=Path, required=True, help="scratch_run.py JSON")
    ap.add_argument("--corpus", type=Path, required=True, help="origin_build.py --out dir")
    ap.add_argument("--scratch-review", type=Path, required=True, help="scratch_run.py --out dir")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    rows = merge(_load(args.import_scorecard)["specimens"], _load(args.scratch_scorecard))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "scorecard.json").write_text(
        json.dumps({"summary": summarize(rows), "specimens": rows}, indent=1), encoding="utf-8")
    (args.out / "scorecard.md").write_text(to_markdown(rows), encoding="utf-8")
    from scorecard_page import write_page

    n = write_page(rows, args.corpus, args.scratch_review, args.out)
    print(f"{len(rows)} specimens, {n} images -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
