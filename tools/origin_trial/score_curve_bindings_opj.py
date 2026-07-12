"""Standalone precision/recall scorer for item 11's ``.opj`` curve->column
binding decoder, run against the absolute local-only corpus path (never
pushed).

Usage::

    uv run python tools/origin_trial/score_curve_bindings_opj.py

Reports per-graph precision/recall against each stem's ``index.json`` oracle
(``specimens/ground_truth/<stem>/index.json``), plus the aggregate counts
recorded in ``docs/origin_project_format.md`` sec 6.1 (39/46 Moke, 6/24 XRD --
the shortfall is two structurally distinct, out-of-reach window kinds:
FitLinear analysis report graphs and per-column sparklines, not undecoded
curves). Mirrors
``tests/test_io_origin_figures_opj_curves.py::test_realdata_curve_bindings_precision_and_recall_floor``
but as a plain script (no pytest) for quick ad-hoc re-validation after a
decoder change. Sibling to ``score_curve_bindings.py`` (the ``.opju`` scorer).
"""

from __future__ import annotations

import os

import json
import sys
from pathlib import Path

CORPUS_ROOT = Path(os.environ.get("QZ_TEST_DATA_ROOT") or (Path(__file__).resolve().parents[3] / "test-data")) / "origin"
GT = CORPUS_ROOT / "specimens" / "ground_truth"

STEMS = ["Moke", "XRD"]


def _oracle_plots_by_graph(index_path: Path) -> dict[str, list[tuple[str, str]]]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[str, str]]] = {}
    for g in index["graphs"]:
        pairs: list[tuple[str, str]] = []
        for layer in g["layers"]:
            for plotref in layer["plots"]:
                book = plotref.split("]")[0][1:]
                rest = plotref.split("]", 1)[1]
                sheetcol = rest.split("!", 1)[1] if "!" in rest else rest
                col = sheetcol.split('"')[0]
                pairs.append((book, col))
        out[g["graph"]] = pairs
    return out


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
    from quantized.io.origin_project.figures import extract_figures

    total_correct = 0
    total_oracle = 0
    total_wrong = 0

    for stem in STEMS:
        src = CORPUS_ROOT / f"{stem}.opj"
        index_path = GT / stem / "index.json"
        if not src.exists() or not index_path.exists():
            print(f"{stem}: SKIP (file or oracle not present at {src})")
            continue
        oracle = _oracle_plots_by_graph(index_path)
        n_oracle = sum(len(v) for v in oracle.values())
        figs = extract_figures(src.read_bytes())
        by_name = {f["name"]: f for f in figs}

        correct = 0
        wrong: list[tuple[str, tuple[str, str]]] = []
        missing_graphs: list[str] = []
        for gname, expected in oracle.items():
            f = by_name.get(gname)
            if f is None:
                missing_graphs.append(gname)
                continue
            decoded = [(c["book"], c["y"]) for c in f["curves"]]
            remaining = list(expected)
            for d in decoded:
                if d in remaining:
                    remaining.remove(d)
                    correct += 1
                else:
                    wrong.append((gname, d))

        total_correct += correct
        total_oracle += n_oracle
        total_wrong += len(wrong)

        status = "OK" if not wrong else f"WRONG={wrong}"
        recall = correct / n_oracle if n_oracle else 1.0
        print(
            f"{stem:8s} oracle={n_oracle:3d} correct={correct:3d} wrong={len(wrong):2d} "
            f"recall={recall:6.1%}  unreachable_graphs={missing_graphs}  {status}"
        )

    print()
    agg_recall = total_correct / total_oracle if total_oracle else 0.0
    agg_precision = (
        total_correct / (total_correct + total_wrong) if (total_correct + total_wrong) else 1.0
    )
    print(
        f"AGGREGATE: correct={total_correct}/{total_oracle} oracle refs "
        f"(recall={agg_recall:.1%}), wrong={total_wrong} (precision={agg_precision:.1%})"
    )
    return 0 if total_wrong == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
