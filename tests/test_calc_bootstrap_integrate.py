"""Bootstrap/posterior fit uncertainty (calc.fit_bootstrap) + integrate-only
peaks (calc.peak_integrate).

Oracles: analytic OLS standard errors for the linear-model bootstrap
(residual bootstrap SE must approach the closed-form SE), Gaussian area
A*sigma*sqrt(2*pi) for integration, and determinism under a fixed seed.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.fit_bootstrap import bootstrap_fit, fit_posterior
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.stats import lin_regress


def _line(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] + p[1] * x, dtype=float)


_N = 60
_X = np.linspace(0.0, 6.0, _N)
# deterministic pseudo-noise, zero-mean-ish, sd ~0.1
_NOISE = 0.1 * np.sin(37.7 * _X + 0.9) + 0.06 * np.cos(91.3 * _X)
_Y = 1.0 + 2.5 * _X + _NOISE


def test_bootstrap_is_deterministic_and_brackets_truth() -> None:
    a = bootstrap_fit(_X, _Y, _line, [0.5, 1.0], n_boot=200, seed=7)
    b = bootstrap_fit(_X, _Y, _line, [0.5, 1.0], n_boot=200, seed=7)
    np.testing.assert_array_equal(a["boot_se"], b["boot_se"])  # same seed, same result
    assert a["ciLow"][0] <= 1.0 <= a["ciHigh"][0]
    assert a["ciLow"][1] <= 2.5 <= a["ciHigh"][1]
    assert a["n_failed"] == 0


def test_bootstrap_se_matches_analytic_ols() -> None:
    ref = lin_regress(_X, _Y, order=1)
    out = bootstrap_fit(_X, _Y, _line, [0.5, 1.0], n_boot=400, seed=1)
    # residual bootstrap SE ~ analytic OLS SE (within 35% at n_boot=400)
    for k in range(2):
        assert abs(out["boot_se"][k] - ref["se"][k]) / ref["se"][k] < 0.35


def test_bootstrap_pairs_method_also_brackets() -> None:
    out = bootstrap_fit(_X, _Y, _line, [0.5, 1.0], n_boot=200, method="pairs", seed=3)
    assert out["ciLow"][1] <= 2.5 <= out["ciHigh"][1]
    assert out["method"] == "pairs"


def test_bootstrap_errors() -> None:
    with pytest.raises(ValueError, match="method"):
        bootstrap_fit(_X, _Y, _line, [0.5, 1.0], method="jackknife")
    with pytest.raises(ValueError, match="n_boot"):
        bootstrap_fit(_X, _Y, _line, [0.5, 1.0], n_boot=5)


def test_posterior_centers_on_the_fit() -> None:
    out = fit_posterior(_X, _Y, _line, [0.5, 1.0], num_steps=4000, burn_in=500, seed=11)
    assert 0.0 < out["accept_rate"] < 1.0
    for k in range(2):
        assert out["ci68Low"][k] <= out["params"][k] <= out["ci68High"][k]
    # posterior median close to the optimum (well-conditioned line fit)
    np.testing.assert_allclose(out["posterior_median"], out["params"], rtol=0.05, atol=0.05)


def test_integrate_gaussian_on_slope() -> None:
    x = np.linspace(3.0, 7.0, 2001)
    amp, sigma, c = 10.0, 0.2, 5.0
    y = 2.0 + 0.3 * x + amp * np.exp(-0.5 * ((x - c) / sigma) ** 2)
    out = integrate_peaks(x, y, [(3.5, 6.5)])
    (pk,) = out["peaks"]
    assert math.isclose(pk["area"], amp * sigma * math.sqrt(2 * math.pi), rel_tol=2e-3)
    assert math.isclose(pk["centroid"], c, abs_tol=5e-3)
    assert math.isclose(pk["height"], amp, rel_tol=2e-3)
    assert math.isclose(pk["fwhm"], 2.3548 * sigma, rel_tol=5e-3)
    assert math.isclose(pk["area_pct"], 100.0, abs_tol=1e-9)


def test_integrate_two_peaks_pct_split() -> None:
    x = np.linspace(0.0, 10.0, 4001)
    y = (10.0 * np.exp(-0.5 * ((x - 3.0) / 0.2) ** 2)
         + 5.0 * np.exp(-0.5 * ((x - 7.0) / 0.2) ** 2))
    out = integrate_peaks(x, y, [(2.0, 4.0), (6.0, 8.0)], baseline="none")
    p1, p2 = out["peaks"]
    assert math.isclose(p1["area_pct"], 200.0 / 3.0, rel_tol=1e-3)
    assert math.isclose(p2["area_pct"], 100.0 / 3.0, rel_tol=1e-3)


def test_integrate_errors() -> None:
    x = np.linspace(0, 1, 50)
    with pytest.raises(ValueError, match="baseline"):
        integrate_peaks(x, x, [(0.2, 0.8)], baseline="spline")
    with pytest.raises(ValueError, match="fewer than 3"):
        integrate_peaks(x, x, [(5.0, 6.0)])
    with pytest.raises(ValueError, match="at least one region"):
        integrate_peaks(x, x, [])
