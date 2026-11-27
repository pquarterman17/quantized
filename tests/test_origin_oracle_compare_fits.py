"""quantized's registry fits against Origin's own fit of the same function.

For each built-in function #1096 ported, ``tools/origin_oracle`` has Origin
fit a seeded noisy curve with its own function (``oracle_cases_fit``). Three
checks per fixture, from the strictest independent evidence down:

1. **Formula**: the model evaluated at Origin's fitted parameters must give
   Origin's own residual sum of squares (1e-6). This does not depend on any
   optimiser; it fails for a wrong formula, a different parameter order or a
   different parameterisation.
2. **Fit from Origin's start**: ``curve_fit`` from the start values Origin
   chose, with the registry bounds, reaches Origin's parameters (1e-4
   relative) and their standard errors (1e-3). Where the fit is
   ill-conditioned (``CURVE_ONLY``) the fitted *curve* is compared instead.
3. **Fit from the planted start**: the same, from the planted parameters, so
   a degenerate Origin start cannot hide a model that fits fine.

Known differences are strict xfails with the reason, never loosened
tolerances. Skips without the local ``../test-data`` corpus.
"""

from __future__ import annotations

import sys
import warnings
from pathlib import Path

import numpy as np
import pytest

from _origin_oracle_fit import OriginFit, read_fit
from _origin_oracle_fixture import load_fixture
from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fitting import curve_fit

TOOLS = Path(__file__).resolve().parents[1] / "tools" / "origin_oracle"
sys.path.insert(0, str(TOOLS))

import oracle_cases  # noqa: E402

pytestmark = pytest.mark.realdata

IDS = sorted(c.id for c in oracle_cases.FIT_CASES if not c.not_exercised)

_SHALLOW = (
    "shallow minimum: both optimisers stop on a flat valley, so parameters agree only to "
    "1e-5..3e-4, standard errors to 1e-3..7e-2 and the residual sum of squares to 1e-5"
)
# Parameters are not separately identified (or only to ~1e-4) on this data: the fitted
# CURVE must agree to 2e-4 of the data span instead. Measured: parameter disagreement
# and the curve disagreement of each (see the commit message).
CURVE_ONLY: dict[str, str] = {
    "fit_bigaussian": _SHALLOW + " (params 2.5e-4, curve 8.9e-5)",
    "fit_bwf": _SHALLOW + " (params 9.4e-5, curve 3.1e-5)",
    "fit_doniachsunjic": _SHALLOW + " (params 1.5e-4, curve 1.1e-4)",
    "fit_ecs": _SHALLOW + " (params 2.6e-5, errors 1.1e-2)",
    "fit_gaussmod": _SHALLOW + " (params 9.4e-5, errors 5e-3)",
    "fit_giddings": _SHALLOW + " (params 1.2e-5, errors 1.3e-3)",
    "fit_logistpk": _SHALLOW + " (params 6e-6, errors 1.7e-3)",
    "fit_pearsonvii": _SHALLOW + " (params 3.8e-5, errors 8.6e-3)",
    "fit_invspoly": "7 parameters of an inverse polynomial: params differ 2.6e-2, curve 2e-9",
}
# id -> reason; strict xfail. A real difference between quantized's model and Origin's.
FORMULA_DIFFERS: dict[str, str] = {
    "fit_pulse": "below x0 Origin's Pulse evaluates to y0, quantized's to 0 (the Origin "
    "definition text says 0); with y0 the residual sum of squares matches to 1e-15",
    "fit_weibull3": "outside the support (S <= 0) Origin's model is undefined and the point is "
    "dropped (n = 56 of 60); quantized returns y0 there and keeps it in the fit. On the "
    "56 defined points the residual sum of squares matches to 1e-15",
    "fit_beta": "outside the support Origin's model is undefined and the points are dropped "
    "(n = 15 of 60); quantized returns y0 there. On the 15 points the sum of squares matches 1e-15",
    "fit_schulzflory": "no permutation of the 4 parameters reproduces Origin's residual sum of "
    "squares (2.32 vs 0.0748 at Origin's own parameters), and Origin cannot fit data generated "
    "from quantized's formula from the planted start either: the formulas differ",
}
# id -> reason; strict xfail on the fit that starts from Origin's own start values.
STALLS_FROM_ORIGIN_START: dict[str, str] = {
    "fit_farazdaghiharris": "Origin's start (a=-3975, b=3977, c=5e-6) is a huge cancelling pair; "
    "quantized's simplex stalls at 361x Origin's sum of squares; from the planted start it "
    "reaches Origin's optimum to 1e-8",
}
# id -> reason: Origin's reported fit is above the minimum quantized finds (it stops short),
# so only "quantized is no worse" can be asserted, not parameter equality.
ORIGIN_STOPS_SHORT: dict[str, str] = {
    "fit_exponentialcdf": "Origin ends 3% above the minimum quantized reaches (Succeeded(100))",
}


def _fit(fx_id: str) -> OriginFit:
    return read_fit(load_fixture(fx_id))


def _origin_is_oracle(f: OriginFit) -> bool:
    """Origin reached the noise floor, so its parameters are the optimum."""
    if not f.converged or not np.all(np.isfinite(f.params)) or np.max(np.abs(f.params)) > 1e8:
        return False  # a diverged "Succeeded" fit (BET: b = -4e152) is not an oracle
    try:
        rss, dof = float(f.stats["rss"]), float(f.stats["dof"])
    except (TypeError, ValueError):
        return False
    sigma = float(load_fixture(f.case_id).planted["noise_sigma"])
    return bool(np.isfinite(rss) and rss > 0 and dof > 0 and rss / (dof * sigma**2) < 3.0)


def _rss(f: OriginFit, p: np.ndarray) -> float:
    r = f.y - FIT_MODELS[f.function]["fcn"](f.x, p)
    return float(r @ r)


def _quantized_fit(f: OriginFit, start: np.ndarray) -> dict[str, object]:
    m = FIT_MODELS[f.function]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return curve_fit(f.x, f.y, m["fcn"], start, lower=m["lb"], upper=m["ub"])


def _params(xfail: dict[str, str]) -> list[object]:
    """Every fixture id; those in ``xfail`` are strict expected failures with the reason."""
    return [
        pytest.param(i, marks=pytest.mark.xfail(strict=True, reason=xfail[i]))
        if i in xfail
        else i
        for i in IDS
    ]


@pytest.mark.parametrize("fx_id", _params(FORMULA_DIFFERS))
def test_model_reproduces_origins_residual_sum_of_squares(fx_id: str) -> None:
    f = _fit(fx_id)
    if not np.all(np.isfinite(f.params)) or f.stats["rss"] in (None, 0):
        pytest.skip("Origin produced no usable fit for this function")
    assert _rss(f, f.params) == pytest.approx(float(f.stats["rss"]), rel=1e-6)


@pytest.mark.parametrize("fx_id", _params(STALLS_FROM_ORIGIN_START | FORMULA_DIFFERS))
def test_fit_from_origins_start_reaches_origins_optimum(fx_id: str) -> None:
    f = _fit(fx_id)
    if not _origin_is_oracle(f):
        pytest.skip("Origin did not reach the noise floor; not an oracle for parameters")
    _assert_same_optimum(f, f.start, fx_id)


@pytest.mark.parametrize("fx_id", _params(FORMULA_DIFFERS))
def test_fit_from_planted_start_reaches_origins_optimum(fx_id: str) -> None:
    f = _fit(fx_id)
    if not _origin_is_oracle(f):
        pytest.skip("Origin did not reach the noise floor; not an oracle for parameters")
    planted = np.asarray(load_fixture(fx_id).planted["params"], dtype=float)
    _assert_same_optimum(f, planted, fx_id)


def _assert_same_optimum(f: OriginFit, start: np.ndarray, fx_id: str) -> None:
    r = _quantized_fit(f, start)
    p = np.asarray(r["params"], dtype=float)
    # Never worse than Origin's own minimum (a stall would show here first).
    assert _rss(f, p) <= _rss(f, f.params) * (1 + 1e-6)
    if fx_id in ORIGIN_STOPS_SHORT:
        return
    if fx_id in CURVE_ONLY:
        fcn = FIT_MODELS[f.function]["fcn"]
        span = float(np.ptp(f.y))
        np.testing.assert_allclose(fcn(f.x, p), fcn(f.x, f.params), rtol=0, atol=2e-4 * span)
        return
    np.testing.assert_allclose(p, f.params, rtol=1e-4, atol=1e-8)
    np.testing.assert_allclose(np.asarray(r["errors"], dtype=float), f.errors, rtol=1e-3)


def _alt_rss(fx_id: str, alt: object) -> tuple[float, float]:
    """(residual sum of squares of ``alt`` at Origin's parameters, Origin's own)."""
    f = _fit(fx_id)
    x, p = f.x, f.params
    return float(np.sum((f.y - alt(x, p)) ** 2)), float(f.stats["rss"])  # type: ignore[operator]


def test_pulse_is_y0_below_x0_in_origin() -> None:
    def alt(x: np.ndarray, p: np.ndarray) -> np.ndarray:
        y0, x0, a, t1, pw, t2 = p
        with np.errstate(all="ignore"):
            body = y0 + a * (1 - np.exp(-(x - x0) / t1)) ** pw * np.exp(-(x - x0) / t2)
        return np.where(x < x0, y0, body)

    got, want = _alt_rss("fit_pulse", alt)
    assert got == pytest.approx(want, rel=1e-9)


@pytest.mark.parametrize("fx_id", ["fit_weibull3", "fit_beta"])
def test_origin_drops_points_outside_the_support(fx_id: str) -> None:
    """quantized's model is exactly ``y0`` outside the support; Origin leaves those points
    undefined and out of the fit, so the sum of squares over the others must match."""
    f = _fit(fx_id)
    q = FIT_MODELS[f.function]["fcn"](f.x, f.params)
    inside = q != f.params[0]
    assert int(f.stats["n"]) == int(inside.sum()) or fx_id == "fit_weibull3"
    got = float(np.sum((f.y - q)[inside] ** 2))
    if fx_id == "fit_weibull3":  # the far tail is also inexact y0; count by the S > 0 rule
        y0, xc, _, w1, w2 = f.params
        s = (f.x - xc) / w1 + ((w2 - 1) / w2) ** (1 / w2)
        got = float(np.sum((f.y - q)[s > 0] ** 2))
        assert int(f.stats["n"]) == int((s > 0).sum())
    assert got == pytest.approx(float(f.stats["rss"]), rel=1e-9)
