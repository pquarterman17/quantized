"""BG-from-region (box-mask + polyfit): golden parity vs the BosonPlotter
'Fit BG from Box' core (onBGMouseUp), plus unit tests for masking/errors."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.baseline import fit_region_background


@pytest.mark.golden
def test_fit_region_background_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_bgregion.json")
    x = np.asarray(g["x"], dtype=float)
    y = np.asarray(g["y"], dtype=float)
    assert len(g["cases"]) == 4
    for c in g["cases"]:
        r = fit_region_background(
            x, y, c["x_min"], c["x_max"],
            y_min=c["y_min"], y_max=c["y_max"], order=int(c["order"]),
        )
        assert r["n_points"] == int(c["n"])
        assert_allclose(r["coeffs"], np.asarray(c["coeffs"], dtype=float),
                        rtol=1e-9, atol=1e-9, err_msg=f"coeffs order={c['order']}")
        assert_allclose(r["background"], np.asarray(c["background"], dtype=float),
                        rtol=1e-9, atol=1e-9, err_msg=f"background order={c['order']}")
        assert r["mean"] == pytest.approx(c["mean"], rel=1e-12)
        assert r["std"] == pytest.approx(c["std"], rel=1e-12)
        assert r["min"] == pytest.approx(c["min"], rel=1e-12)
        assert r["max"] == pytest.approx(c["max"], rel=1e-12)


# ── unit tests ────────────────────────────────────────────────────────────────

def test_linear_region_recovers_slope_intercept() -> None:
    x = np.linspace(0, 10, 100)
    y = 3.0 + 2.0 * x  # pure line
    r = fit_region_background(x, y, 2.0, 8.0, order=1)
    # polyfit order 1 -> [slope, intercept]
    assert r["coeffs"][0] == pytest.approx(2.0, abs=1e-9)
    assert r["coeffs"][1] == pytest.approx(3.0, abs=1e-9)
    assert_allclose(r["background"], y, atol=1e-9)  # evaluated across full x


def test_y_bounds_filter_and_recover_flat_bg() -> None:
    x = np.linspace(0, 10, 201)
    y = 2.0 + 100 * np.exp(-((x - 5) / 0.05) ** 2)  # flat bg=2 + very narrow tall peak
    full = fit_region_background(x, y, 0.0, 10.0, order=1)
    bounded = fit_region_background(x, y, 0.0, 10.0, y_max=10.0, order=1)
    assert bounded["n_points"] < full["n_points"]  # the peak points are dropped
    # with the peak excluded the fit sits on the flat background (intercept ~2, slope ~0)
    assert bounded["coeffs"][1] == pytest.approx(2.0, abs=0.1)
    assert abs(bounded["coeffs"][0]) < 0.02


def test_too_few_points_raises() -> None:
    x = np.linspace(0, 10, 100)
    y = x.copy()
    with pytest.raises(ValueError, match="at least 2 points"):
        fit_region_background(x, y, 4.999, 5.0, order=1)  # window catches <2 points


def test_order_exceeds_points_raises() -> None:
    x = np.array([1.0, 2.0, 3.0])
    y = np.array([1.0, 4.0, 9.0])
    with pytest.raises(ValueError, match="order-3"):
        fit_region_background(x, y, 0.0, 10.0, order=3)  # 3 points < order+1=4
