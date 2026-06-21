"""Curve-fit model library: golden parity vs MATLAB fitting.models."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_models import FIT_MODELS, evaluate, model_names


@pytest.mark.golden
def test_fit_models_match_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_fit_models.json")
    x = np.asarray(g["x"], dtype=float)
    tested = 0
    skipped = []
    for m in g["models"]:
        name = m["name"]
        if name not in FIT_MODELS:
            skipped.append(name)  # helper-based model not yet registered
            continue
        y = evaluate(name, x, np.asarray(m["p0"], dtype=float))
        assert_allclose(
            y, np.asarray(m["y"], dtype=float), rtol=1e-9, atol=1e-12, err_msg=name
        )
        tested += 1
    assert tested >= 20, f"expected >=20 models tested, got {tested} (skipped {skipped})"


def test_fit_models_metadata_consistent() -> None:
    for name, m in FIT_MODELS.items():
        assert len(m["p0"]) == m["nParams"], name
        assert len(m["lb"]) == m["nParams"], name
        assert len(m["ub"]) == m["nParams"], name
        assert len(m["paramNames"]) == m["nParams"], name


def test_gaussian_evaluates_peak() -> None:
    x = np.linspace(-5.0, 5.0, 101)
    y = evaluate("Gaussian", x, [2.0, 0.0, 1.0])  # A=2, mu=0, sigma=1
    assert y[np.argmax(y)] == pytest.approx(2.0)
    assert x[np.argmax(y)] == pytest.approx(0.0)


def test_linear_and_lorentzian() -> None:
    x = np.linspace(0.0, 10.0, 50)
    assert_allclose(evaluate("Linear", x, [2.0, 1.0]), 2.0 * x + 1.0)
    y = evaluate("Lorentzian", x, [1.0, 5.0, 1.0])  # peak at x0=5
    assert x[np.argmax(y)] == pytest.approx(5.0, abs=0.3)


def test_model_names_nonempty() -> None:
    names = model_names()
    assert "Gaussian" in names
    assert "Pseudo-Voigt" in names
    assert len(names) >= 20
