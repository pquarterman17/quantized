"""York regression (calc/fit_york.py): benchmark, limiting cases, bad input,
and an optional Origin FitLRXErr oracle comparison."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.calc.fit_odr import odr_fit
from quantized.calc.fit_york import york_fit

# "Pearson's data with York's weights" (10 points). Table as printed in the
# Kapteyn package example kmpfit_Pearsonsdata_compare.py
# (https://www.astro.rug.nl/software/kapteyn-beta/EXAMPLES/kmpfit_Pearsonsdata_compare.py),
# from Pearson (1901), Phil. Mag. 2, 559, with the weights of York (1966),
# Can. J. Phys. 44, 1079. Weights are 1/sigma^2.
_X = [0.0, 0.9, 1.8, 2.6, 3.3, 4.4, 5.2, 6.1, 6.5, 7.4]
_Y = [5.9, 5.4, 4.4, 4.6, 3.5, 3.7, 2.8, 2.8, 2.4, 1.5]
_WX = np.array([1000.0, 1000, 500, 800, 200, 80, 60, 20, 1.8, 1.0])
_WY = np.array([1.0, 1.8, 4, 8, 20, 20, 70, 70, 100, 500])
_SX = 1.0 / np.sqrt(_WX)
_SY = 1.0 / np.sqrt(_WY)


def test_pearson_york_benchmark() -> None:
    r = york_fit(_X, _Y, _SX, _SY)
    # Slope and intercept as quoted in that example for Williamson's solution:
    # a = 5.47991022403, b = -0.48053340745 (Reed 5.47991022723 / -0.48053340810,
    # Lybanon 5.47991025 / -0.480533415 agree to the digits they print).
    assert r["slope"] == pytest.approx(-0.48053340745, abs=1e-10)
    assert r["intercept"] == pytest.approx(5.47991022403, abs=1e-10)
    # Standard errors and goodness of fit as printed in the bfsl R package's
    # documented summary (Pearson/York example, York et al. 2004 equations):
    # intercept 5.47991 +- 0.29497, slope -0.48053 +- 0.05799, goodness of fit
    # 1.483, chi-square 11.87 on 8 degrees of freedom.
    assert r["slopeErr"] == pytest.approx(0.05799, abs=5e-6)
    assert r["interceptErr"] == pytest.approx(0.29497, abs=5e-6)
    assert r["mswd"] == pytest.approx(1.483, abs=5e-4)
    assert r["chiSq"] == pytest.approx(11.87, abs=5e-3)
    assert r["dof"] == 8 and r["n"] == 10


def test_no_x_error_is_weighted_least_squares_on_y() -> None:
    rng = np.random.default_rng(3)
    x = np.linspace(0.0, 10.0, 12)
    sy = rng.uniform(0.1, 0.5, x.size)
    y = 2.0 * x + 1.0 + rng.normal(0.0, sy)
    r = york_fit(x, y, np.full(x.size, 1e-9), sy)
    slope, intercept = np.polyfit(x, y, 1, w=1.0 / sy)
    assert_allclose([r["slope"], r["intercept"]], [slope, intercept], rtol=1e-6)


def test_equal_constant_errors_match_deming_at_ratio_one() -> None:
    rng = np.random.default_rng(4)
    x = np.linspace(0.0, 10.0, 15)
    y = 0.7 * x + 2.0 + rng.normal(0.0, 0.4, x.size)
    err = np.full(x.size, 0.3)
    york = york_fit(x, y, err, err)
    deming = odr_fit(x, y, lambda_=1.0)
    assert york["slope"] == pytest.approx(deming["slope"], rel=1e-10)
    assert york["intercept"] == pytest.approx(deming["intercept"], rel=1e-10)


def test_correlation_changes_the_fit_and_zero_rho_is_the_default() -> None:
    a = york_fit(_X, _Y, _SX, _SY)
    zero = york_fit(_X, _Y, _SX, _SY, rho=np.zeros(10))
    assert zero["slope"] == a["slope"]
    some = york_fit(_X, _Y, _SX, _SY, rho=np.full(10, 0.5))
    assert abs(some["slope"] - a["slope"]) > 1e-4


@pytest.mark.parametrize(
    "x_error, y_error, match",
    [
        (np.zeros(10), _SY, "x_error"),
        (-_SX, _SY, "x_error"),
        (_SX, np.where(np.arange(10) == 3, 0.0, _SY), "y_error"),
        (np.where(np.arange(10) == 2, np.nan, _SX), _SY, "x_error"),
        (_SX[:5], _SY, "same length"),
    ],
)
def test_bad_errors_are_refused(x_error: np.ndarray, y_error: np.ndarray, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        york_fit(_X, _Y, x_error, y_error)


def test_bad_points_are_refused() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        york_fit(_X[:2], _Y[:2], _SX[:2], _SY[:2])
    with pytest.raises(ValueError, match="finite"):
        york_fit([*_X[:-1], math.inf], _Y, _SX, _SY)
    with pytest.raises(ValueError, match="finite"):
        york_fit(_X, [*_Y[:-1], math.nan], _SX, _SY)
    with pytest.raises(ValueError, match="rho"):
        york_fit(_X, _Y, _SX, _SY, rho=np.full(10, 1.0))
    with pytest.raises(ValueError, match="all equal"):
        york_fit([1.0, 1.0, 1.0], [1.0, 2.0, 3.0], [0.1] * 3, [0.1] * 3)


def test_route_returns_the_fit_and_422_on_bad_input(client: TestClient) -> None:
    body = {"x": _X, "y": _Y, "x_error": _SX.tolist(), "y_error": _SY.tolist()}
    ok = client.post("/api/fitting/york", json=body)
    assert ok.status_code == 200
    assert ok.json()["slope"] == pytest.approx(-0.48053340745, abs=1e-10)
    bad = client.post("/api/fitting/york", json={**body, "x_error": [0.0] * 10})
    assert bad.status_code == 422


@pytest.mark.realdata
def test_matches_origin_fitlrxerr_oracle(corpus_dir: Path) -> None:
    """Origin's FitLRXErr on the same 20 points (reports errors scaled by sqrt(MSWD))."""
    case = corpus_dir / "origin" / "analysis_oracle" / "fitlrxerr"
    if not (case / "oracle.json").is_file():
        pytest.skip("Origin fitlrxerr oracle fixture not present")
    ref = json.loads((case / "oracle.json").read_text(encoding="utf-8"))["values"]
    d = np.genfromtxt(case / "input.csv", delimiter=",", names=True)
    r = york_fit(d["x"], d["y"], d["x_err"], d["y_err"])
    assert_allclose(r["slope"], ref["qz_slope"], rtol=1e-9)
    assert_allclose(r["intercept"], ref["qz_intercept"], rtol=1e-9)
    assert_allclose(r["slopeErrScaled"], ref["qz_slope_err"], rtol=1e-9)
    assert_allclose(r["interceptErrScaled"], ref["qz_intercept_err"], rtol=1e-9)
    assert_allclose(r["chiSq"], ref["qz_chisq"], rtol=1e-9)
    assert_allclose(r["mswd"], ref["qz_redchisq"], rtol=1e-9)
    assert r["dof"] == ref["qz_dof"]
