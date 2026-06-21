"""Peak-shape profiles: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.peakshapes import pseudo_voigt, split_pearson_vii, tch_pseudo_voigt


@pytest.mark.golden
def test_pseudo_voigt_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_pseudovoigt.json")
    p = g["params"]
    out = pseudo_voigt(
        np.asarray(g["input"], dtype=float), p["x0"], p["fwhm"], p["H"], p["eta"], p["bg"]
    )
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_split_pearson_vii_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_splitpearson.json")
    out = split_pearson_vii(np.asarray(g["input"], dtype=float), g["params"]["p"])
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_tch_pseudo_voigt_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_tchpv.json")
    out = tch_pseudo_voigt(np.asarray(g["input"], dtype=float), g["params"]["p"])
    compare_calc(out, g["output"])
