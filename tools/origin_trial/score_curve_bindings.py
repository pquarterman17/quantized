"""Standalone precision/recall scorer for item 35's curve->column binding
decoder, run against the absolute local-only corpus path (never pushed).

Usage::

    uv run python tools/origin_trial/score_curve_bindings.py

Reports per-stem precision/recall against each stem's ``plots.json`` oracle
(``specimens/ground_truth/<stem>/plots.json``), plus the aggregate recall
used in ``plans/ORIGIN_FILE_DECODE_PLAN.md`` item 35 and
``docs/origin_project_format.md`` sec 6.2.1. Mirrors
``tests/test_io_origin_figures_opju.py::test_realdata_curve_bindings_vs_plots_oracle``
but as a plain script (no pytest) for quick ad-hoc re-validation after a
decoder change.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

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
    return 0 if total_wrong == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
