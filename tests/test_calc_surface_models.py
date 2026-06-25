"""2D surface model library (calc/surface_models.py) — formula-verified.

Each expected value comes straight from the documented equation; no MATLAB
golden needed for pure model evaluation.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.surface_models import get_surface_model, surface_models


def test_catalog_has_expected_models() -> None:
    names = [m.name for m in surface_models()]
    assert names == [
        "Plane",
        "Paraboloid",
        "2D Gaussian",
        "2D Lorentzian",
        "2D Pseudo-Voigt",
        "Polynomial 2D",
        "Exponential Decay 2D",
    ]


def test_param_counts_match_names() -> None:
    for m in surface_models():
        assert m.n_params == len(m.param_names)


def test_unknown_model_raises() -> None:
    with pytest.raises(ValueError, match="unknown surface model"):
        get_surface_model("nope")


def test_plane_is_linear() -> None:
    f = get_surface_model("Plane").func
    z = f([2.0, 3.0, 1.0], np.array([1.0, 0.0]), np.array([0.0, 1.0]))
    np.testing.assert_allclose(z, [2 * 1 + 1, 3 * 1 + 1])


def test_gaussian2d_peaks_at_centre() -> None:
    # A=5, x0=1, sx=2, y0=-1, sy=3, z0=0.5 -> at (x0,y0) z = A + z0.
    f = get_surface_model("2D Gaussian").func
    p = [5.0, 1.0, 2.0, -1.0, 3.0, 0.5]
    z0 = f(p, np.array([1.0]), np.array([-1.0]))
    assert z0[0] == pytest.approx(5.0 + 0.5)
    # One sigma out along x drops by exp(-1/2).
    z1 = f(p, np.array([1.0 + 2.0]), np.array([-1.0]))
    assert z1[0] == pytest.approx(5.0 * np.exp(-0.5) + 0.5)


def test_lorentzian2d_peaks_at_centre() -> None:
    f = get_surface_model("2D Lorentzian").func
    p = [4.0, 0.0, 1.0, 0.0, 1.0, 0.0]
    assert f(p, np.array([0.0]), np.array([0.0]))[0] == pytest.approx(4.0)
    # At (wx, 0): denom = 1 + 1 = 2 -> A/2.
    assert f(p, np.array([1.0]), np.array([0.0]))[0] == pytest.approx(2.0)


def test_pseudo_voigt_eta_endpoints() -> None:
    f = get_surface_model("2D Pseudo-Voigt").func
    g = get_surface_model("2D Gaussian").func
    lor = get_surface_model("2D Lorentzian").func
    base = [3.0, 0.5, 1.5, -0.5, 2.0, 0.2]
    x = np.array([0.5, 1.0, 2.0])
    y = np.array([-0.5, 0.0, 1.0])
    # eta = 1 -> pure Lorentzian; eta = 0 -> pure Gaussian (same A/centre/width/z0).
    np.testing.assert_allclose(f([*base, 1.0], x, y), lor(base, x, y))
    np.testing.assert_allclose(f([*base, 0.0], x, y), g(base, x, y))


def test_pseudo_voigt_clamps_eta() -> None:
    f = get_surface_model("2D Pseudo-Voigt").func
    base = [3.0, 0.0, 1.0, 0.0, 1.0, 0.0]
    x = np.array([0.3, 0.7])
    y = np.array([0.1, -0.2])
    np.testing.assert_allclose(f([*base, 5.0], x, y), f([*base, 1.0], x, y))  # >1 -> 1
    np.testing.assert_allclose(f([*base, -3.0], x, y), f([*base, 0.0], x, y))  # <0 -> 0


def test_poly2d_matches_formula() -> None:
    f = get_surface_model("Polynomial 2D").func
    p = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    x, y = 2.0, 3.0
    expected = 1 + 2 * x + 3 * y + 4 * x**2 + 5 * x * y + 6 * y**2
    assert f(p, np.array([x]), np.array([y]))[0] == pytest.approx(expected)


def test_zero_width_is_floored_not_divergent() -> None:
    # sx = 0 must not blow up (MATLAB max(p, eps) floor).
    f = get_surface_model("2D Gaussian").func
    z = f([1.0, 0.0, 0.0, 0.0, 1.0, 0.0], np.array([0.0]), np.array([0.0]))
    assert np.isfinite(z[0])
