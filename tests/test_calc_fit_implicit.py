"""fit_implicit: algebraic + geometric ellipse fits against known parameters."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.fit_implicit import ellipse_points, fit_ellipse

TRUE = (3.0, -2.0, 5.0, 2.0, 30.0)  # cx, cy, a, b, theta(deg)


def _sample(t: np.ndarray, sigma: float = 0.0, seed: int = 1):
    cx, cy, a, b, th = TRUE[0], TRUE[1], TRUE[2], TRUE[3], np.radians(TRUE[4])
    x = cx + a * np.cos(t) * np.cos(th) - b * np.sin(t) * np.sin(th)
    y = cy + a * np.cos(t) * np.sin(th) + b * np.sin(t) * np.cos(th)
    if sigma:
        rng = np.random.default_rng(seed)
        x = x + rng.normal(0, sigma, t.size)
        y = y + rng.normal(0, sigma, t.size)
    return x, y


def test_noiseless_exact_recovery() -> None:
    x, y = _sample(np.linspace(0, 2 * np.pi, 60, endpoint=False))
    r = fit_ellipse(x, y)
    got = (r["center_x"], r["center_y"], r["semi_major"], r["semi_minor"], r["angle_deg"])
    assert got == pytest.approx(TRUE, abs=1e-6)
    assert r["rms"] < 1e-8
    assert r["algebraic"]["semi_major"] == pytest.approx(TRUE[2], abs=1e-8)


def test_noisy_fit_within_reported_errors() -> None:
    t = np.random.default_rng(0).uniform(0, 2 * np.pi, 300)
    x, y = _sample(t, sigma=0.05)
    r = fit_ellipse(x, y)
    for key, true in zip(
        ("center_x", "center_y", "semi_major", "semi_minor", "angle_deg"), TRUE, strict=True
    ):
        se = r[key + "_se"]
        assert 0 < se < 0.2, key
        assert abs(r[key] - true) < 4 * se, key
    assert r["rms"] == pytest.approx(0.05, rel=0.2)
    assert r["converged"] is True


def test_geometric_beats_algebraic_on_a_partial_arc() -> None:
    t = np.random.default_rng(2).uniform(0.0, 1.6, 120)  # ~quarter of the curve
    x, y = _sample(t, sigma=0.03, seed=4)
    r = fit_ellipse(x, y)
    alg = r["algebraic"]
    err_alg = abs(alg["semi_major"] - TRUE[2]) + abs(alg["semi_minor"] - TRUE[3])
    err_geo = abs(r["semi_major"] - TRUE[2]) + abs(r["semi_minor"] - TRUE[3])
    assert err_geo < err_alg  # algebraic fit is biased on short arcs
    assert r["semi_major_se"] > 0.1  # and the uncertainty honestly reflects it


def test_axes_ordered_and_angle_normalised() -> None:
    # Same ellipse described with the minor axis first.
    th = np.radians(30 + 90)
    t = np.linspace(0, 2 * np.pi, 50, endpoint=False)
    x = 1 + 2 * np.cos(t) * np.cos(th) - 5 * np.sin(t) * np.sin(th)
    y = 1 + 2 * np.cos(t) * np.sin(th) + 5 * np.sin(t) * np.cos(th)
    r = fit_ellipse(x, y)
    assert r["semi_major"] >= r["semi_minor"]
    assert 0 <= r["angle_deg"] < 180
    assert r["angle_deg"] == pytest.approx(30.0, abs=1e-5)


def test_algebraic_only_and_curve_points() -> None:
    x, y = _sample(np.linspace(0, 2 * np.pi, 40, endpoint=False), sigma=0.02)
    r = fit_ellipse(x, y, geometric=False)
    assert r["geometric"] is False
    assert np.isnan(r["center_x_se"])
    cx, cy = ellipse_points(
        r["center_x"], r["center_y"], r["semi_major"], r["semi_minor"], r["angle_deg"], 50
    )
    assert cx.shape == cy.shape == (50,)


def test_rejects_bad_input() -> None:
    with pytest.raises(ValueError, match="at least 5"):
        fit_ellipse([0, 1, 2], [0, 1, 0])
    with pytest.raises(ValueError):
        fit_ellipse([1.0] * 8, [2.0] * 8)
    with pytest.raises(ValueError):
        fit_ellipse(np.arange(10.0), 2 * np.arange(10.0))  # collinear
    with pytest.raises(ValueError, match="same length"):
        fit_ellipse([1, 2, 3, 4, 5], [1, 2])
