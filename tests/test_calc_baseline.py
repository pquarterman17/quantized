"""Baseline estimation: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.baseline import baseline_als


@pytest.mark.golden
def test_baseline_als_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_baseline_als.json")
    out = baseline_als(np.asarray(g["input"], dtype=float))
    # ALS uses an iterative sparse solve; allow a slightly looser tolerance.
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-6)


def test_baseline_als_tracks_lower_envelope(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_baseline_als.json")
    y = np.asarray(g["input"], dtype=float)
    bl = baseline_als(y)
    assert bl.shape == y.shape
    assert np.all(np.isfinite(bl))
    # Peaks pull the data well above the baseline, so on average bl < y.
    assert float(np.mean(bl)) < float(np.mean(y))
