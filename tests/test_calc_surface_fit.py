"""surface_fit: bounded 2D least-squares fitting (calc/surface_fit.py).

Verified by synthetic recovery — generate data from known parameters, fit, and
check the optimiser recovers them. (Exact MATLAB parity needs a golden freeze;
Nelder-Mead↔fminsearch matches ~1e-5..1e-16 on clean data, so recovery is a
sound proxy here.)
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.surface_fit import surface_auto_guess, surface_fit
from quantized.calc.surface_models import get_surface_model


def _grid(n: int = 21, lo: float = -5.0, hi: float = 5.0) -> tuple[np.ndarray, np.ndarray]:
    gx, gy = np.meshgrid(np.linspace(lo, hi, n), np.linspace(lo, hi, n))
    return gx.ravel(), gy.ravel()


def test_recovers_a_2d_gaussian() -> None:
    x, y = _grid()
    true = [10.0, 1.0, 1.5, -1.0, 2.0, 2.0]  # A, x0, sx, y0, sy, z0
    z = get_surface_model("2D Gaussian").func(true, x, y)
    # Lower-bound the widths positive to remove the sx -> -sx sign ambiguity.
    res = surface_fit(
        x, y, z, "2D Gaussian",
        p0=[8.0, 0.5, 1.0, -0.5, 1.5, 1.0],
        lower=[0.0, -np.inf, 0.05, -np.inf, 0.05, -np.inf],
    )
    np.testing.assert_allclose(res["params"], true, rtol=2e-2, atol=2e-2)
    assert res["r2"] > 0.9999
    assert res["exit_flag"] == 1
    assert np.all(np.isfinite(res["errors"]))
    assert np.all(res["errors"] >= 0)


def test_plane_recovers_exact_coefficients() -> None:
    x, y = _grid(n=11)
    z = 2.0 * x + 3.0 * y + 1.0
    res = surface_fit(x, y, z, "Plane", p0=[0.0, 0.0, 0.0])
    np.testing.assert_allclose(res["params"], [2.0, 3.0, 1.0], rtol=1e-6, atol=1e-6)
    assert res["r2"] == pytest.approx(1.0, abs=1e-9)
    assert res["rmse"] == pytest.approx(0.0, abs=1e-6)


def test_bounds_are_respected() -> None:
    x, y = _grid(n=11)
    z = get_surface_model("2D Gaussian").func([10.0, 1.0, 1.5, -1.0, 2.0, 2.0], x, y)
    # Cap the amplitude below the true value — the fit must not exceed the bound.
    res = surface_fit(
        x, y, z, "2D Gaussian",
        p0=[5.0, 0.0, 1.0, 0.0, 1.0, 0.0],
        lower=[0.0, -5, 0.05, -5, 0.05, -5],
        upper=[6.0, 5, 5, 5, 5, 5],
    )
    assert res["params"][0] <= 6.0 + 1e-6  # amplitude capped


def test_p0_wrong_size_raises() -> None:
    x, y = _grid(n=5)
    z = np.zeros_like(x)
    with pytest.raises(ValueError, match="p0 must have 6 elements"):
        surface_fit(x, y, z, "2D Gaussian", p0=[1.0, 2.0, 3.0])


def test_bounds_wrong_size_raises() -> None:
    x, y = _grid(n=5)
    z = np.zeros_like(x)
    with pytest.raises(ValueError, match="lower must have 3 elements"):
        surface_fit(x, y, z, "Plane", p0=[0.0, 0.0, 0.0], lower=[0.0, 0.0])


def test_result_shapes() -> None:
    x, y = _grid(n=9)
    z = 1.0 + x - y
    res = surface_fit(x, y, z, "Plane", p0=[0.0, 0.0, 0.0])
    assert res["z_fit"].shape == x.shape
    assert res["residuals"].shape == x.shape
    assert res["param_names"] == ["a", "b", "c"]
    assert res["n_points"] == x.size
    assert res["n_free"] == 3


# ── surface_auto_guess ────────────────────────────────────────────────────
def test_auto_guess_gaussian_in_the_ballpark() -> None:
    x, y = _grid()
    true = [10.0, 1.0, 1.5, -1.0, 2.0, 2.0]
    z = get_surface_model("2D Gaussian").func(true, x, y)
    g = surface_auto_guess("2D Gaussian", x, y, z)
    assert g.size == 6
    assert g[0] == pytest.approx(10.0, rel=0.1)  # amplitude ~ zmax - zmin
    assert g[1] == pytest.approx(1.0, abs=0.5)  # weighted centroid near x0
    assert g[3] == pytest.approx(-1.0, abs=0.5)  # near y0
    assert g[5] == pytest.approx(z.min())  # z0 = baseline


def test_auto_guess_plane_solves_normal_equations() -> None:
    x, y = _grid(n=11)
    z = 2.0 * x + 3.0 * y + 1.0
    g = surface_auto_guess("Plane", x, y, z)
    np.testing.assert_allclose(g, [2.0, 3.0, 1.0], rtol=1e-9, atol=1e-9)


def test_auto_guess_pseudo_voigt_has_eta() -> None:
    x, y = _grid(n=9)
    z = get_surface_model("2D Gaussian").func([5.0, 0.0, 1.0, 0.0, 1.0, 0.0], x, y)
    g = surface_auto_guess("2D Pseudo-Voigt", x, y, z)
    assert g.size == 7
    assert g[6] == pytest.approx(0.5)  # eta default


def test_surface_fit_without_p0_uses_auto_guess() -> None:
    x, y = _grid()
    true = [10.0, 1.0, 1.5, -1.0, 2.0, 2.0]
    z = get_surface_model("2D Gaussian").func(true, x, y)
    res = surface_fit(
        x, y, z, "2D Gaussian",
        lower=[0.0, -np.inf, 0.05, -np.inf, 0.05, -np.inf],
    )  # no p0 -> auto-guessed
    np.testing.assert_allclose(res["params"], true, rtol=3e-2, atol=3e-2)
    assert res["r2"] > 0.999
