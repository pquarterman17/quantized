"""Statistics utilities: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.stats import descriptive_stats


@pytest.mark.golden
def test_descriptive_stats_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_descriptive.json")
    out = descriptive_stats(np.asarray(g["input"], dtype=float))
    compare_calc(out, g["output"])


def test_descriptive_stats_empty() -> None:
    out = descriptive_stats(np.array([]))
    assert out["N"] == 0
    assert np.isnan(out["mean"])
