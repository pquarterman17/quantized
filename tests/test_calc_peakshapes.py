"""Peak-shape profiles: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.peakshapes import pseudo_voigt, split_pearson_vii, tch_pseudo_voigt, voigt


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


def test_voigt_reduces_to_its_gaussian_and_lorentzian_limits() -> None:
    # New capability (no MATLAB Voigt): the limits pin the width conventions.
    x = np.linspace(-4.0, 4.0, 161)
    np.testing.assert_allclose(voigt(x, 0.3, 1.2, 0.0, 7.0, 1.0),
                               pseudo_voigt(x, 0.3, 1.2, 7.0, 0.0, 1.0), rtol=1e-12)
    np.testing.assert_allclose(voigt(x, 0.3, 0.0, 1.2, 7.0, 1.0),
                               pseudo_voigt(x, 0.3, 1.2, 7.0, 1.0, 1.0), rtol=1e-12)
    assert voigt(np.array([0.3]), 0.3, 0.8, 0.5, 7.0)[0] == pytest.approx(7.0, rel=1e-14)
    with pytest.raises(ValueError, match="not both zero"):
        voigt(x, 0.0, 0.0, 0.0, 1.0)
