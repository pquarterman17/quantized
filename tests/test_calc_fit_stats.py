"""fitCompare / residualDiagnostics / fitBands: golden parity vs MATLAB +fitting."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fit_stats import fit_bands, fit_compare, residual_diagnostics


@pytest.mark.golden
def test_fit_compare_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fitcompare.json")
    inp = g["input"]
    out = fit_compare(
        np.asarray(inp["y"], dtype=float),
        np.asarray(inp["residuals"], dtype=float),
        int(inp["nParams"]),
        resid_ref=np.asarray(inp["residRef"], dtype=float),
        n_params_ref=float(inp["nParamsRef"]),
    )
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-9)


@pytest.mark.golden
def test_residual_diagnostics_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_residdiag.json")
    out = residual_diagnostics(np.asarray(g["input"], dtype=float))
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-9)


@pytest.mark.golden
def test_fit_bands_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fitbands.json")
    inp = g["input"]
    out = fit_bands(
        np.asarray(inp["xGrid"], dtype=float),
        FIT_MODELS["Gaussian"]["fcn"],
        np.asarray(inp["params"], dtype=float),
        np.asarray(inp["covar"], dtype=float),
        int(inp["nPoints"]),
        int(inp["nFree"]),
    )
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-9)


def test_fit_compare_perfect_fit() -> None:
    y = np.linspace(0.0, 10.0, 50)
    out = fit_compare(y, np.zeros(50), 2)
    assert out["R2"] == pytest.approx(1.0)
    assert out["aic"] == float("-inf")  # perfect fit -> -Inf


def test_residual_diagnostics_white_noise_structure() -> None:
    rng = np.random.default_rng(0)
    r = rng.normal(size=200)
    d = residual_diagnostics(r)
    assert d["nPos"] + d["nNeg"] == 200
    assert 1.5 < d["durbinWatson"] < 2.5  # uncorrelated -> DW near 2
    assert len(d["qqX"]) == 200


def test_fit_bands_ci_inside_pi() -> None:
    x = np.linspace(0.0, 20.0, 30)
    params = np.array([5.0, 10.0, 2.0])
    covar = np.diag([0.01, 0.001, 0.001])
    b = fit_bands(x, FIT_MODELS["Gaussian"]["fcn"], params, covar, 80, 3)
    assert np.all(b["ciHi"] <= b["piHi"] + 1e-12)  # CI band inside PI band
    assert np.all(b["ciLo"] >= b["piLo"] - 1e-12)
    assert np.all(b["ciHi"] >= b["ciLo"])
