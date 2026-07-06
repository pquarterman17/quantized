"""Standalone precision/recall scorer for the ``.opju`` curve->column binding
decoder, run against the absolute local-only corpus path (never pushed).

Usage::

    uv run python tools/origin_trial/score_curve_bindings.py

Two sections:

* per-stem file-level precision/recall against each stem's ``plots.json``
  oracle (``specimens/ground_truth/<stem>/plots.json``) — the original
  item-35 harness, mirrors ``tests/test_io_origin_figures_opju.py::
  test_realdata_curve_bindings_vs_plots_oracle``;
* **per-graph** scoring (2026-07-05, the id-table rework) against each
  stem's ``index.json`` ``graphs[].layers[].plots`` where that export is
  populated (only the newer exports carry it — the older stems' lists came
  back empty and assert nothing). Decoded figures are matched to oracle
  graphs by their page-derived ``name``; a name-matched graph must have
  ZERO wrong bindings. The Hc2 oracle is truncated by Origin's eval page
  limit, so unmatched decoded graphs are unverifiable, never wrong.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

CORPUS_ROOT = Path("C:/Users/patri/OneDrive/Coding/git/test-data/origin")
SPEC = CORPUS_ROOT / "specimens"
GT = SPEC / "ground_truth"

# Stems living directly in specimens/ (purpose-built, by-construction truth)
# vs. the parent test-data/origin/ dir (the real corpus).
SPECIMEN_DIR_STEMS = {"fig_pairs", "curves_multi", "curves_2books"}
STEMS = [
    "fig_pairs",
    "curves_multi",
    "curves_2books",
    "XAS",
    "RockingCurve",
    "UnpolPlots",
    "Fixed Lambdas SI",
]

_PLOT_REF_RE = re.compile(r'\[(?P<book>[^\]]+)\](?:"[^"]*"|[^!"]*)!(?P<col>[A-Za-z]+)')


def _oracle_pairs(plots_path: Path) -> set[tuple[str, str]]:
    data = json.loads(plots_path.read_text(encoding="utf-8"))
    out: set[tuple[str, str]] = set()
    for layers in data.values():
        for refs in layers.values():
            for ref in refs:
                m = _PLOT_REF_RE.match(ref)
                if m:
                    out.add((m.group("book"), m.group("col")))
    return out


def _per_graph(
    extract: Callable[[bytes], list[dict[str, Any]]], stem: str, src: Path
) -> int:
    """Per-graph scoring vs a populated index.json; returns the wrong count."""
    index_path = GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        return 0
    index = json.loads(index_path.read_text(encoding="utf-8"))
    oracle: dict[str, set[tuple[str, str]]] = {}
    for g in index.get("graphs", []):
        pairs = {
            (m.group("book"), m.group("col"))
            for layer in g.get("layers", [])
            for ref in layer.get("plots", [])
            if (m := _PLOT_REF_RE.match(ref))
        }
        if pairs:
            oracle[g["graph"]] = pairs
    if not oracle:
        return 0
    figs = extract(src.read_bytes())
    named: dict[str, set[tuple[str, str]]] = {}
    for f in figs:
        if f["name"]:
            named.setdefault(f["name"], set()).update((c["book"], c["y"]) for c in f["curves"])
    exact, incomplete, unmatched, wrong_total = [], [], [], 0
    for gname, pairs in sorted(oracle.items()):
        decoded = named.get(gname)
        if decoded is None:
            unmatched.append(gname)
            continue
        wrong = decoded - pairs
        if wrong:
            wrong_total += len(wrong)
            print(f"  {stem}/{gname}: WRONG {sorted(wrong)}")
        elif decoded == pairs:
            exact.append(gname)
        else:
            incomplete.append(gname)
    print(
        f"{stem:20s} per-graph: oracle={len(oracle)} exact={len(exact)} "
        f"incomplete={len(incomplete)} name-unmatched={len(unmatched)} WRONG={wrong_total}"
    )
    if exact:
        print(f"  exact: {exact}")
    if incomplete:
        print(f"  incomplete (missing-only): {incomplete}")
    return wrong_total


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    total_correct = 0
    total_oracle = 0
    total_wrong = 0
    rows: list[tuple[str, int, int, int, float]] = []

    for stem in STEMS:
        plots_path = GT / stem / "plots.json"
        src = SPEC / f"{stem}.opju" if stem in SPECIMEN_DIR_STEMS else SPEC.parent / f"{stem}.opju"
        if not src.exists() or not plots_path.exists():
            print(f"{stem}: SKIP (file or oracle not present at {src})")
            continue
        oracle = _oracle_pairs(plots_path)
        figs = extract_figures_opju(src.read_bytes())
        decoded = {(c["book"], c["y"]) for f in figs for c in f["curves"]}

        wrong = decoded - oracle
        correct = decoded & oracle
        recall = len(correct) / len(oracle) if oracle else 1.0
        precision = len(correct) / len(decoded) if decoded else 1.0

        total_correct += len(correct)
        total_oracle += len(oracle)
        total_wrong += len(wrong)
        rows.append((stem, len(oracle), len(decoded), len(correct), recall))

        status = "OK" if not wrong else f"WRONG={sorted(wrong)}"
        print(
            f"{stem:20s} oracle={len(oracle):3d} decoded={len(decoded):3d} "
            f"correct={len(correct):3d} wrong={len(wrong):2d} "
            f"precision={precision:6.1%} recall={recall:6.1%}  {status}"
        )

    print()
    agg_recall = total_correct / total_oracle if total_oracle else 0.0
    agg_precision = (
        (total_correct) / (total_correct + total_wrong) if (total_correct + total_wrong) else 1.0
    )
    print(
        f"AGGREGATE: correct={total_correct}/{total_oracle} oracle pairs "
        f"(recall={agg_recall:.1%}), wrong={total_wrong} "
        f"(precision={agg_precision:.1%})"
    )

    print()
    graph_wrong = 0
    for stem in ("Hc2 data", "curves_multi", "curves_2books"):
        src = (
            SPEC / f"{stem}.opju"
            if stem in SPECIMEN_DIR_STEMS or (SPEC / f"{stem}.opju").exists()
            else SPEC.parent / f"{stem}.opju"
        )
        graph_wrong += _per_graph(extract_figures_opju, stem, src)
    return 0 if total_wrong == 0 and graph_wrong == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
