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


def test_orthogonal_distance_is_the_nearest_foot_point_for_inner_points() -> None:
    from quantized.calc.fit_implicit import _orth_distances

    p = np.array([0.5, -0.25, 5.0, 2.0, np.radians(20)])
    rng = np.random.default_rng(3)
    # Centre, major-axis and random inner / outer points: a single Newton start
    # from the polar angle can settle on the far-side stationary point.
    x = np.r_[p[0], p[0] + 0.8 * np.cos(p[4]), rng.uniform(-6, 6, 40)]
    y = np.r_[p[1], p[1] + 0.8 * np.sin(p[4]), rng.uniform(-4, 4, 40)]
    got = _orth_distances(p, x, y)
    t = np.linspace(0, 2 * np.pi, 20001)
    ex, ey = ellipse_points(p[0], p[1], p[2], p[3], np.degrees(p[4]), t.size)
    brute = np.array(
        [np.sqrt(np.min((ex - xi) ** 2 + (ey - yi) ** 2)) for xi, yi in zip(x, y, strict=True)]
    )
    assert got == pytest.approx(brute, abs=2e-3)


def test_standard_errors_are_absent_not_zero_when_unidentifiable() -> None:
    # Exactly 5 points determine an ellipse with no residual degrees of freedom.
    x, y = _sample(np.array([0.1, 1.3, 2.4, 3.9, 5.2]))
    r = fit_ellipse(x, y)
    assert np.isnan(r["semi_major_se"]) and np.isnan(r["center_x_se"])
    assert r["semi_major"] == pytest.approx(TRUE[2], abs=1e-6)


def test_exact_circle_loses_only_the_angle_standard_error() -> None:
    t = np.random.default_rng(0).uniform(0, 2 * np.pi, 120)
    rng = np.random.default_rng(1)
    x = 2 + 3 * np.cos(t) + rng.normal(0, 0.02, t.size)
    y = -1 + 3 * np.sin(t) + rng.normal(0, 0.02, t.size)
    r = fit_ellipse(x, y)
    assert np.isnan(r["angle_deg_se"])
    for key in ("center_x_se", "center_y_se", "semi_major_se", "semi_minor_se"):
        assert 0 < r[key] < 0.05, key
    assert r["semi_major"] == pytest.approx(3.0, abs=0.05)


def test_arc_coverage_reports_how_much_of_the_curve_the_points_span() -> None:
    full = fit_ellipse(*_sample(np.linspace(0, 2 * np.pi, 60, endpoint=False)))
    assert full["arc_coverage_deg"] > 340
    arc = fit_ellipse(*_sample(np.linspace(0.2, 1.7, 60), sigma=0.01))
    assert 70 < arc["arc_coverage_deg"] < 125
