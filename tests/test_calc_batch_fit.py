"""Batch curve fitting across datasets: golden parity vs MATLAB fitting.batchFit."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.batch_fit import batch_fit
from quantized.calc.fit_models import FIT_MODELS
from quantized.datastruct import DataStruct

_EXP = FIT_MODELS["Exponential Decay"]["fcn"]


def _inf_bounds(v: list[float | None], sign: float) -> list[float]:
    # jsonencode writes ±Inf as null; restore it.
    return [sign * math.inf if x is None else float(x) for x in v]


@pytest.mark.golden
def test_batch_fit_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_batchfit.json")
    x = np.asarray(g["x"], dtype=float)
    datasets = [(x, np.asarray(yi, dtype=float)) for yi in g["y"]]
    lower = _inf_bounds(g["lb"], -1.0)
    upper = _inf_bounds(g["ub"], 1.0)
    s = batch_fit(datasets, _EXP, g["p0"], lower=lower, upper=upper,
                  model_name="Exponential Decay")
    ref = g["summary"]
    assert_allclose(np.asarray(s["params"]), np.asarray(ref["params"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(np.asarray(s["errors"]), np.asarray(ref["errors"], dtype=float),
                    rtol=1e-6, atol=1e-8)
    for key in ("R2", "chiSqRed", "RMSE", "AIC"):
        assert_allclose(np.asarray(s[key]), np.asarray(ref[key], dtype=float),
                        rtol=1e-6, atol=1e-8, err_msg=key)
    assert s["exitFlags"] == [int(v) for v in ref["exitFlags"]]
    assert s["converged"] == [bool(v) for v in ref["converged"]]
    assert s["nDatasets"] == int(ref["nDatasets"])


def _decay_series(taus: list[float]) -> list[tuple[np.ndarray, np.ndarray]]:
    x = np.linspace(0.0, 10.0, 80)
    return [(x, _EXP(x, np.array([5.0, t, 0.5]))) for t in taus]


def test_batch_fit_recovers_each_tau() -> None:
    taus = [1.2, 2.4, 3.6]
    s = batch_fit(_decay_series(taus), _EXP, [4.0, 1.0, 0.0], model_name="Exponential Decay")
    fitted = [s["params"][i][1] for i in range(3)]
    assert_allclose(fitted, taus, rtol=1e-4)
    assert all(s["converged"])
    assert s["paramNames"] == FIT_MODELS["Exponential Decay"]["paramNames"]


def test_batch_fit_skips_too_few_points() -> None:
    s = batch_fit([(np.array([1.0, 2.0]), np.array([1.0, 2.0]))], _EXP, [1.0, 1.0, 0.0])
    assert s["nDatasets"] == 1
    assert math.isnan(s["R2"][0])
    assert s["converged"] == [False]
    assert s["paramNames"] == ["p1", "p2", "p3"]  # no model_name → positional names


def test_batch_fit_extracts_metadata_from_datastruct() -> None:
    x = np.linspace(0.0, 10.0, 80)
    datasets = [
        DataStruct.create(x, _EXP(x, np.array([5.0, t, 0.5])), labels=["y"], units=["a"],
                          metadata={"temperature": 100.0 + 10.0 * j})
        for j, t in enumerate([1.5, 2.5, 3.5])
    ]
    s = batch_fit(datasets, _EXP, [4.0, 1.0, 0.0], model_name="Exponential Decay",
                  meta_field="temperature")
    assert s["metaValues"] == [100.0, 110.0, 120.0]


def test_batch_fit_invalid_weights_raises() -> None:
    with pytest.raises(ValueError, match="weights"):
        batch_fit(_decay_series([2.0]), _EXP, [4.0, 1.0, 0.0], weights="1/sqrt")
