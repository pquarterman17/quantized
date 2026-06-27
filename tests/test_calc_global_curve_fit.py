"""Global curve fit with named per-group shared parameters: golden parity vs
MATLAB fitting.globalCurveFit (+ unit tests for the sharing/alias machinery)."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.global_curve_fit import global_curve_fit

CASES = ["gauss_shared_sigma", "gauss_no_constraint", "gauss_subset", "exp_shared_tau"]


def _gauss(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2)), dtype=float)


def _exp(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


_FCN: dict[str, Callable[[np.ndarray, np.ndarray], np.ndarray]] = {
    "gauss_shared_sigma": _gauss,
    "gauss_no_constraint": _gauss,
    "gauss_subset": _gauss,
    "exp_shared_tau": _exp,
}
# Bounds passed explicitly (Inf doesn't survive jsonencode → we don't read them back).
_BOUNDS: dict[str, tuple[list[float], list[float]]] = {
    "gauss_shared_sigma": ([-math.inf, -math.inf, 0.1], [math.inf, math.inf, 10.0]),
    "gauss_no_constraint": ([-math.inf, -math.inf, 0.1], [math.inf, math.inf, 10.0]),
    "gauss_subset": ([-math.inf, -math.inf, 0.1], [math.inf, math.inf, 10.0]),
    "exp_shared_tau": ([-math.inf, 0.0, -math.inf], [math.inf, math.inf, math.inf]),
}


def _constraints_py(raw: Any) -> list[dict[str, Any]]:
    """MATLAB constraint dataset indices are 1-based → 0-based for Python."""
    out: list[dict[str, Any]] = []
    for c in raw or []:
        out.append({"param_name": c["paramName"],
                    "datasets": [int(d) - 1 for d in np.atleast_1d(c["datasets"])]})
    return out


@pytest.mark.golden
@pytest.mark.parametrize("case", CASES)
def test_global_curve_fit_matches_matlab(
    case: str, load_golden: Callable[[str], dict[str, Any]]
) -> None:
    g = load_golden("calc_globalcurvefit.json")[case]
    x = np.asarray(g["x"], dtype=float)
    datasets = [(x, np.asarray(yi, dtype=float)) for yi in g["y"]]
    lower, upper = _BOUNDS[case]
    r = global_curve_fit(
        datasets, _FCN[case], g["paramNames"], _constraints_py(g["constraints"]),
        init_guess=g["initGuess"], lower=lower, upper=upper,
    )
    ref = g["result"]
    assert_allclose(np.asarray(r["params"]), np.asarray(ref["params"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(np.asarray(r["errors"]), np.asarray(ref["errors"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(r["R2"], np.atleast_1d(np.asarray(ref["R2"], dtype=float)).ravel(),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(r["RMSE"], np.atleast_1d(np.asarray(ref["RMSE"], dtype=float)).ravel(),
                    rtol=1e-6, atol=1e-8)
    assert r["chiSqRed"] == pytest.approx(ref["chiSqRed"], rel=1e-6)
    assert r["nFree"] == int(ref["nFree"])
    assert r["nTotal"] == int(ref["nTotal"])
    assert r["exitFlag"] == int(ref["exitFlag"])

    ref_shared = ref["shared"]
    ref_list = [] if ref_shared == [] else (
        ref_shared if isinstance(ref_shared, list) else [ref_shared]
    )
    assert len(r["shared"]) == len(ref_list)
    for got, exp in zip(r["shared"], ref_list, strict=True):
        assert got["value"] == pytest.approx(exp["value"], rel=1e-6, abs=1e-8)
        assert got["error"] == pytest.approx(exp["error"], rel=1e-6, abs=1e-8)
        # MATLAB 1-based paramIdx/datasets → 0-based in Python
        assert got["paramIdx"] == int(exp["paramIdx"]) - 1
        assert sorted(got["datasets"]) == sorted(int(d) - 1 for d in np.atleast_1d(exp["datasets"]))


# ── unit tests (no MATLAB needed) ────────────────────────────────────────────

def test_recovers_shared_param_clean() -> None:
    x = np.linspace(-5, 5, 80)
    true = [(10.0, -1.0, 1.2), (6.0, 0.5, 1.2), (8.0, 1.5, 1.2)]  # shared sigma
    ds = [(x, _gauss(x, np.array(t))) for t in true]
    r = global_curve_fit(
        ds, _gauss, ["A", "mu", "sigma"],
        [{"param_name": "sigma", "datasets": [0, 1, 2]}],
        init_guess=[[9, -0.8, 1.0], [5, 0.4, 1.0], [7, 1.3, 1.0]],
        lower=[0, -10, 0.1], upper=[100, 10, 10],
    )
    assert r["nFree"] == 7  # 1 shared + 3*2 free
    assert r["shared"][0]["value"] == pytest.approx(1.2, abs=1e-4)
    for i, (amp, ctr, _sig) in enumerate(true):
        assert r["params"][i][0] == pytest.approx(amp, abs=1e-3)
        assert r["params"][i][1] == pytest.approx(ctr, abs=1e-3)


def test_no_constraint_is_independent_batch() -> None:
    x = np.linspace(-5, 5, 60)
    ds = [(x, _gauss(x, np.array([10.0, 0.0, 1.0]))) for _ in range(3)]
    r = global_curve_fit(ds, _gauss, ["A", "mu", "sigma"], None,
                         init_guess=[[9, 0.1, 1.1]] * 3, lower=[0, -10, 0.1], upper=[100, 10, 10])
    assert r["nFree"] == 9  # 3 datasets * 3 params, nothing shared
    assert r["shared"] == []


def test_subset_sharing_param_count() -> None:
    x = np.linspace(-5, 5, 60)
    ds = [(x, _gauss(x, np.array([10.0, float(c), 1.2]))) for c in (-1, 0, 1)]
    r = global_curve_fit(ds, _gauss, ["A", "mu", "sigma"],
                         [{"param_name": "sigma", "datasets": [0, 1]}],  # ds2 keeps own sigma
                         init_guess=[[9, -0.8, 1.0], [9, 0.1, 1.0], [9, 1.1, 1.0]],
                         lower=[0, -10, 0.1], upper=[100, 10, 10])
    assert r["nFree"] == 8  # 1 shared + (3*3 - 2 folded)
    assert r["shared"][0]["datasets"] == [0, 1]


def test_greek_alias_resolution() -> None:
    # paramNames use the Greek glyph; constraint names it in ASCII.
    x = np.linspace(-5, 5, 50)
    ds = [(x, _gauss(x, np.array([10.0, float(c), 1.2]))) for c in (-1, 1)]
    r = global_curve_fit(ds, _gauss, ["A", "μ", "σ"],
                         [{"param_name": "sigma", "datasets": [0, 1]}],
                         init_guess=[[9, -0.8, 1.0], [9, 1.1, 1.0]],
                         lower=[0, -10, 0.1], upper=[100, 10, 10])
    assert r["shared"][0]["paramIdx"] == 2  # resolved σ
    assert r["shared"][0]["value"] == pytest.approx(1.2, abs=1e-3)


def test_unknown_param_raises() -> None:
    x = np.linspace(0, 1, 10)
    with pytest.raises(ValueError, match="not found"):
        global_curve_fit([(x, x)], _gauss, ["A", "mu", "sigma"],
                         [{"param_name": "nope", "datasets": [0, 1]}], init_guess=[[1, 0, 1]])


def test_empty_datasets_raises() -> None:
    with pytest.raises(ValueError, match="at least one dataset"):
        global_curve_fit([], _gauss, ["A", "mu", "sigma"], None, init_guess=[])
