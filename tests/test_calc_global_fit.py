"""Global (shared-parameter) fitting: golden parity vs MATLAB fitting.globalFit."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.global_fit import global_fit


def _exp(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


def _inf_bounds(v: list[float | None], sign: float) -> list[float]:
    return [sign * math.inf if x is None else float(x) for x in v]


@pytest.mark.golden
def test_global_fit_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_globalfit.json")
    x = np.asarray(g["x"], dtype=float)
    datasets = [(x, np.asarray(yi, dtype=float)) for yi in g["y"]]
    r = global_fit(
        datasets, _exp, g["p0"], [bool(v) for v in g["sharedMask"]],
        lower=_inf_bounds(g["lb"], -1.0), upper=_inf_bounds(g["ub"], 1.0),
    )
    ref = g["result"]
    assert_allclose(r["sharedParams"], np.asarray(ref["sharedParams"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(r["sharedErrors"], np.asarray(ref["sharedErrors"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(np.asarray(r["perDataset"]), np.asarray(ref["perDataset"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(np.asarray(r["perErrors"]), np.asarray(ref["perErrors"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(r["R2"], np.asarray(ref["R2"], dtype=float).ravel(), rtol=1e-6, atol=1e-8)
    assert r["R2global"] == pytest.approx(ref["R2global"], rel=1e-6)
    assert r["exitFlag"] == int(ref["exitFlag"])
    assert r["nParams"] == int(ref["nParams"])


def test_global_fit_recovers_shared_and_free_params() -> None:
    x = np.linspace(0.0, 10.0, 60)
    a_true, tau, c = [5.0, 3.0, 7.0], 2.5, 0.5
    datasets = [(x, _exp(x, np.array([a, tau, c]))) for a in a_true]
    r = global_fit(datasets, _exp, [4.0, 2.0, 0.0], [False, True, True])
    assert_allclose(r["sharedParams"], [tau, c], rtol=1e-4)
    assert_allclose([r["perDataset"][i][0] for i in range(3)], a_true, rtol=1e-4)
    assert r["nParams"] == 5  # 2 shared + 3 free


def test_global_fit_all_shared_equals_one_param_block() -> None:
    x = np.linspace(0.0, 10.0, 40)
    datasets = [(x, _exp(x, np.array([5.0, 2.0, 1.0]))) for _ in range(3)]
    r = global_fit(datasets, _exp, [4.0, 1.5, 0.5], [True, True, True])
    assert r["nParams"] == 3  # all shared → just M params
    # every per-dataset row equals the shared solution
    for i in range(3):
        assert_allclose(r["perDataset"][i], r["perDataset"][0], rtol=1e-12)


def test_global_fit_mask_length_mismatch_raises() -> None:
    x = np.linspace(0.0, 10.0, 40)
    with pytest.raises(ValueError, match="shared_mask must have"):
        global_fit([(x, x)], _exp, [1.0, 1.0, 0.0], [True, False])  # 2 != 3


def test_global_fit_invalid_weights_raises() -> None:
    x = np.linspace(0.0, 10.0, 40)
    with pytest.raises(ValueError, match="weights"):
        global_fit([(x, _exp(x, np.array([5.0, 2.0, 1.0])))], _exp, [4.0, 1.5, 0.5],
                   [False, True, True], weights="bad")
