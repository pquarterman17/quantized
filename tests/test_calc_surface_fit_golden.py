"""Golden parity for the 2D surface fitting stack vs MATLAB
fitting.{surfaceModels, surfaceAutoGuess, surfaceFit}. Unit-level recovery is
covered in test_calc_surface_fit.py / test_calc_surface_models.py; this file
pins exact MATLAB parity."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.surface_fit import surface_auto_guess, surface_fit
from quantized.calc.surface_models import get_surface_model


@pytest.fixture
def sf(load_golden: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    return load_golden("calc_surfacefit.json")


@pytest.mark.golden
def test_surface_model_evals_match_matlab(sf: dict[str, Any]) -> None:
    """Every model's closed-form z = f(p, x, y) matches MATLAB exactly."""
    x = np.asarray(sf["x"], dtype=float)
    y = np.asarray(sf["y"], dtype=float)
    assert len(sf["models"]) == 7
    for m in sf["models"]:
        z = get_surface_model(m["name"]).func(np.asarray(m["p"], dtype=float), x, y)
        assert_allclose(z, np.asarray(m["z"], dtype=float), rtol=1e-12, atol=1e-12,
                        err_msg=f"model {m['name']}")


@pytest.mark.golden
def test_surface_auto_guess_matches_matlab(sf: dict[str, Any]) -> None:
    """Per-model heuristic initial guesses match MATLAB (lstsq for linear models,
    intensity-weighted centroid for peak models)."""
    x = np.asarray(sf["x"], dtype=float)
    y = np.asarray(sf["y"], dtype=float)
    assert len(sf["autoguess"]) == 7
    for a in sf["autoguess"]:
        p0 = surface_auto_guess(a["name"], x, y, np.asarray(a["z"], dtype=float))
        assert_allclose(p0, np.asarray(a["p0"], dtype=float), rtol=1e-9, atol=1e-9,
                        err_msg=f"auto-guess {a['name']}")


@pytest.mark.golden
@pytest.mark.parametrize("idx", [0, 1, 2, 3])
def test_surface_fit_matches_matlab(sf: dict[str, Any], idx: int) -> None:
    """Full fits (internal auto-guess + fminsearch over the bound transform +
    Hessian errors) match MATLAB within Nelder-Mead tolerance."""
    x = np.asarray(sf["x"], dtype=float)
    y = np.asarray(sf["y"], dtype=float)
    fc = sf["fits"][idx]
    r = surface_fit(x, y, np.asarray(fc["z"], dtype=float), fc["name"])
    assert r["model_name"] == fc["name"]
    assert_allclose(r["params"], np.asarray(fc["params"], dtype=float),
                    rtol=1e-6, atol=1e-8, err_msg=f"params {fc['name']}")
    assert_allclose(r["errors"], np.asarray(fc["errors"], dtype=float),
                    rtol=1e-6, atol=1e-8, err_msg=f"errors {fc['name']}")
    assert r["r2"] == pytest.approx(fc["R2"], rel=1e-6, abs=1e-9)
    assert r["rmse"] == pytest.approx(fc["RMSE"], rel=1e-6, abs=1e-9)
    assert r["chi_sq_red"] == pytest.approx(fc["chiSqRed"], rel=1e-6)
    assert r["n_points"] == int(fc["nPoints"])
    assert r["n_free"] == int(fc["nFree"])
    assert r["exit_flag"] == int(fc["exitFlag"])
