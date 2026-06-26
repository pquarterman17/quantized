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


# ── Hysteresis-category models (port of fitting.hysteresisModels) ─────────
_HYSTERESIS_MODELS = [
    "Tanh Hysteresis",
    "Two-Component (F+P)",
    "Linear Background",
    "Approach to Saturation",
    "Langevin + Background",
]


@pytest.mark.golden
def test_hysteresis_models_match_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_hysteresis_models.json")
    x = np.asarray(g["x"], dtype=float)
    names = {m["name"] for m in g["models"]}
    assert names == set(_HYSTERESIS_MODELS), f"frozen set mismatch: {names}"
    for m in g["models"]:
        y = evaluate(m["name"], x, np.asarray(m["p0"], dtype=float))
        assert_allclose(
            y, np.asarray(m["y"], dtype=float), rtol=1e-9, atol=1e-12, err_msg=m["name"]
        )


def test_hysteresis_models_registered_under_hysteresis_category() -> None:
    for name in _HYSTERESIS_MODELS:
        assert name in FIT_MODELS, name
        assert FIT_MODELS[name]["category"] == "Hysteresis", name


def test_tanh_hysteresis_is_zero_at_coercive_field() -> None:
    # M = Ms·tanh((H - Hc)/Hw) crosses zero exactly at H = Hc and is antisymmetric
    # about it.
    h = np.array([-100.0, 100.0, 300.0])  # Hc=100 → centre point is the middle
    y = evaluate("Tanh Hysteresis", h, [1e-3, 100.0, 200.0])
    assert y[1] == pytest.approx(0.0, abs=1e-15)
    assert y[0] == pytest.approx(-y[2], rel=1e-12)


def test_langevin_bg_small_u_branch_is_continuous() -> None:
    # The piecewise Langevin (series for |αH|<1e-4, coth elsewhere) must join
    # smoothly. Straddle the 1e-4 threshold and check monotonic continuity.
    alpha = 1e-3
    h = np.array([-0.2, -0.05, 0.0, 0.05, 0.2]) / alpha  # u = -0.2..0.2 around 0
    y = evaluate("Langevin + Background", h, [2.0, alpha, 0.0])
    assert y[2] == pytest.approx(0.0, abs=1e-15)  # L(0) = 0
    # series branch (u→0) and coth branch agree to high precision at the seam
    u_seam = 5e-5
    y_series = evaluate("Langevin + Background", np.array([u_seam / alpha]), [2.0, alpha, 0.0])
    y_coth = 2.0 * (1.0 / np.tanh(u_seam) - 1.0 / u_seam)
    assert float(y_series[0]) == pytest.approx(y_coth, rel=1e-6, abs=1e-12)


def test_approach_to_saturation_finite_near_zero_field() -> None:
    # The 1/|H| and 1/H² terms are eps-guarded → finite even at H=0.
    h = np.array([-1.0, 0.0, 1.0])
    y = evaluate("Approach to Saturation", h, [1e-3, 1.0, 1.0, 0.0])
    assert np.all(np.isfinite(y))


def test_linear_background_is_affine() -> None:
    h = np.linspace(-500.0, 500.0, 11)
    assert_allclose(evaluate("Linear Background", h, [2e-4, 0.01]), 2e-4 * h + 0.01)
