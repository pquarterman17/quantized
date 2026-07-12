"""curveFit engine: golden parity vs MATLAB fitting.curveFit."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fitting import curve_fit, weights_from_dy


def test_weights_from_dy_is_inverse_variance() -> None:
    """The canonical error->weight convention shared by every fit endpoint."""
    w = weights_from_dy([0.5, 1.0, 2.0], 3)
    np.testing.assert_allclose(w, [4.0, 1.0, 0.25])


def test_weights_from_dy_rejects_bad_input() -> None:
    with pytest.raises(ValueError, match="same length"):
        weights_from_dy([1.0, 1.0], 3)
    with pytest.raises(ValueError, match="finite and > 0"):
        weights_from_dy([1.0, 0.0, 2.0], 3)
    with pytest.raises(ValueError, match="finite and > 0"):
        weights_from_dy([1.0, float("nan"), 2.0], 3)


@pytest.mark.golden
def test_curvefit_gaussian_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_curvefit_gauss.json")
    x = np.asarray(g["input"]["x"], dtype=float)
    y = np.asarray(g["input"]["y"], dtype=float)
    m = FIT_MODELS["Gaussian"]
    out = curve_fit(x, y, m["fcn"], g["p0"], lower=m["lb"], upper=m["ub"])
    # scipy Nelder-Mead mirrors fminsearch bit-for-bit here; allow a small margin.
    compare_calc(
        {k: out[k] for k in ("params", "R2", "chiSqRed", "RMSE", "AIC", "errors")},
        g["output"],
        rtol=1e-6,
        atol=1e-9,
    )


def test_curvefit_recovers_gaussian_params() -> None:
    x = np.linspace(0.0, 20.0, 100)
    y = 5.0 * np.exp(-((x - 10.0) ** 2) / (2 * 2.0**2))  # pure Gaussian (3-param model)
    m = FIT_MODELS["Gaussian"]
    # Seed with auto_guess (the intended usage; Nelder-Mead needs a good start).
    p0 = auto_guess("Gaussian", x, y)
    out = curve_fit(x, y, m["fcn"], p0, lower=m["lb"], upper=m["ub"])
    a, mu, sigma = out["params"]
    assert a == pytest.approx(5.0, rel=0.02)
    assert mu == pytest.approx(10.0, rel=0.02)
    assert abs(sigma) == pytest.approx(2.0, rel=0.02)
    assert out["R2"] > 0.999
    assert out["nFree"] == 3
    assert out["nPoints"] == 100


def test_curvefit_respects_bounds() -> None:
    x = np.linspace(0.0, 10.0, 50)
    y = 2.0 * x + 1.0
    m = FIT_MODELS["Linear"]
    # Constrain slope to [0, 5]; fit should land at slope 2.
    out = curve_fit(x, y, m["fcn"], [1.0, 0.0], lower=[0.0, -10.0], upper=[5.0, 10.0])
    assert 0.0 <= out["params"][0] <= 5.0
    assert out["params"][0] == pytest.approx(2.0, rel=1e-3)


def test_curvefit_fixed_param() -> None:
    x = np.linspace(0.0, 10.0, 40)
    y = 3.0 * x + 2.0
    m = FIT_MODELS["Linear"]
    # Fix intercept at 2.0; only slope is free.
    out = curve_fit(x, y, m["fcn"], [1.0, 2.0], fixed=[False, True])
    assert out["params"][1] == 2.0  # untouched
    assert out["nFree"] == 1
    assert out["params"][0] == pytest.approx(3.0, rel=1e-3)


def test_curvefit_errors_finite_and_positive() -> None:
    x = np.linspace(0.0, 20.0, 100)
    y = 5.0 * np.exp(-((x - 10.0) ** 2) / (2 * 2.0**2)) + 0.01 * np.sin(x)
    m = FIT_MODELS["Gaussian"]
    out = curve_fit(x, y, m["fcn"], [4.0, 9.0, 1.5], lower=m["lb"], upper=m["ub"])
    assert np.all(np.isfinite(out["errors"]))
    assert np.all(out["errors"] > 0)
    assert out["covar"] is not None and out["covar"].shape == (3, 3)
