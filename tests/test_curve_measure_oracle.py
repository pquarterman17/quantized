"""Compare calc.curve_measure with the Origin oracle fixtures, when present.

Fixtures live in the private ``test-data`` corpus (analysis-oracle lane):
``origin/analysis_oracle/{intersect,levelcrossing}/`` each hold ``input.csv``
(the seeded curve), ``truth.json`` (the planted crossing positions) and
``oracle.json`` (what Origin 2026b returned). Origin's ``intersect`` writes a
worksheet the harness did not capture, so that case is checked against the
planted positions; ``levelcrossing`` also compares Origin's crossing count
(``values.ncr``). Skips when the corpus or a fixture is absent (CI). Linear
interpolation of a sampled sine is not exact, so positions use a tolerance set
by the grid spacing, not by rounding.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.curve_measure import intersect_curves, level_crossings

pytestmark = pytest.mark.realdata


def _load(corpus: Path, name: str) -> tuple[np.ndarray, dict, dict]:  # type: ignore[type-arg]
    folder = corpus / "origin" / "analysis_oracle" / name
    if not (folder / "input.csv").is_file():
        pytest.skip(f"{folder} not present")
    with (folder / "input.csv").open(encoding="utf-8") as fh:
        rows = np.array([[float(v) for v in r] for r in list(csv.reader(fh))[1:]])
    truth = json.loads((folder / "truth.json").read_text(encoding="utf-8"))
    oracle_path = folder / "oracle.json"
    oracle = json.loads(oracle_path.read_text(encoding="utf-8")) if oracle_path.is_file() else {}
    return rows, truth, oracle


def test_intersect_matches_planted_crossings(corpus_dir: Path) -> None:
    rows, truth, _ = _load(corpus_dir, "intersect")
    r = intersect_curves(rows[:, 0], rows[:, 1], rows[:, 0], rows[:, 2])
    want = truth["planted"]["crossings_x"]
    assert [i.x for i in r.intersections] == pytest.approx(want, abs=0.05)


def test_level_crossings_match_origin(corpus_dir: Path) -> None:
    rows, truth, oracle = _load(corpus_dir, "levelcrossing")
    level = truth["planted"]["level"]
    r = level_crossings(rows[:, 0], rows[:, 1], level)
    assert [c.x for c in r.crossings] == pytest.approx(truth["planted"]["crossings_x"], abs=0.05)
    ncr = oracle.get("values", {}).get("ncr")
    if ncr is not None:
        assert len(r.crossings) == int(ncr)
