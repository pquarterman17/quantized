"""XYZ gridding (item 32): modified Shepard, kriging, Renka-Cline, log axes,
kriging variance, hull clipping and fail-closed input. Each method must
reproduce a planted surface at interior points within a stated tolerance."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from quantized.calc import grid_xyz as gx
from quantized.calc._kriging import ordinary_kriging
from quantized.calc.interp2d import regrid2d

Arr = NDArray[np.float64]
RNG = np.random.default_rng(7)
N = 220
X = RNG.uniform(1.0, 5.0, N)
Y = RNG.uniform(1.0, 3.0, N)
XL, YL = (2.0, 4.0), (1.5, 2.5)  # strictly inside the sampled hull


def plane(x: Arr, y: Arr) -> Arr:
    return np.asarray(2.0 + 0.5 * x - 0.3 * y)


def quad(x: Arr, y: Arr) -> Arr:
    return np.asarray(1.0 + 0.4 * x * x - 0.2 * x * y + 0.1 * y * y)


def smooth(x: Arr, y: Arr) -> Arr:
    return np.asarray(np.sin(0.8 * x) * np.cos(0.9 * y))


def _err(method: str, f: Callable[[Arr, Arr], Arr], **kw: Any) -> float:
    r = gx.grid_xyz(X, Y, f(X, Y), method=method, nx=25, ny=25, xlim=XL, ylim=YL, **kw)
    xx, yy = np.meshgrid(r.x, r.y)
    assert not np.isnan(r.z).any()
    return float(np.max(np.abs(r.z - f(xx, yy))))


def test_shepard_quadratic_reproduces_a_quadratic_exactly() -> None:
    # Renka's quadratic nodal functions: exact on any quadratic (hence planes).
    assert _err("shepard", plane) < 1e-9
    assert _err("shepard", quad) < 1e-8


def test_shepard_classic_weights_are_local_and_close_on_a_plane() -> None:
    e = _err("shepard", plane, options={"shepard_quadratic": False})
    assert e < 0.15  # a value blend is not exact on a plane; measured 0.097
    assert e > 1e-6  # and it really is the classic (non-quadratic) variant


def test_shepard_fixed_radius_has_no_value_where_nothing_is_in_range() -> None:
    r = gx.grid_xyz(X, Y, plane(X, Y), method="shepard", nx=25, ny=25, xlim=XL, ylim=YL,
                    options={"shepard_radius": 0.001})
    assert np.isnan(r.z).any()  # tiny radius: blank, never a guess


def test_kriging_reproduces_smooth_and_linear_surfaces() -> None:
    assert _err("kriging", plane) < 1e-3
    assert _err("kriging", smooth) < 2e-2


@pytest.mark.parametrize("model", ["spherical", "exponential", "gaussian"])
def test_kriging_each_variogram_model_fits_and_interpolates(model: str) -> None:
    r = gx.grid_xyz(X, Y, smooth(X, Y), method="kriging", nx=15, ny=15, xlim=XL, ylim=YL,
                    options={"variogram": model})
    assert r.info["variogram"]["model"] == model
    assert r.info["variogram"]["range"] > 0
    xx, yy = np.meshgrid(r.x, r.y)
    assert float(np.max(np.abs(r.z - smooth(xx, yy)))) < 0.1


def test_kriging_variance_is_zero_at_data_points_and_positive_between() -> None:
    z = smooth(X, Y)
    pred, var, _ = ordinary_kriging(X, Y, z, X[:20], Y[:20])
    assert np.max(var) < 1e-9
    assert np.max(np.abs(pred - z[:20])) < 1e-9
    r = gx.grid_xyz(X, Y, z, method="kriging", nx=20, ny=20, output="variance")
    assert r.variance is not None and np.nanmax(r.variance) > 0
    assert np.nanmin(r.variance) >= 0
    out = gx.grid_datastruct(r, x_label="x", x_unit="", y_label="y", y_unit="",
                             z_unit="V", output="variance")
    assert out.units[2] == "(V)^2"
    assert out.metadata["map_op"]["output"] == "variance"


def test_variance_is_refused_for_other_methods() -> None:
    with pytest.raises(ValueError, match="only kriging"):
        gx.grid_xyz(X, Y, plane(X, Y), method="linear", output="variance")


def test_renka_cline_is_exact_on_a_plane_and_smooth() -> None:
    assert _err("renka", plane) < 1e-6  # gradients are estimated iteratively; measured 1e-8
    assert _err("renka", smooth) < 5e-2


def test_renka_is_not_the_existing_cubic_alias() -> None:
    a = gx.grid_xyz(X, Y, smooth(X, Y), method="renka", nx=15, ny=15, xlim=XL, ylim=YL).z
    b = gx.grid_xyz(X, Y, smooth(X, Y), method="cubic", nx=15, ny=15, xlim=XL, ylim=YL).z
    assert float(np.max(np.abs(a - b))) > 1e-6  # cubic is Sibson natural neighbour


@pytest.mark.parametrize("method", ["shepard", "kriging", "renka"])
def test_hull_clipping_and_opt_in_nearest_fill(method: str) -> None:
    pairs = [(i, j) for i in range(5) for j in range(5) if i + j <= 4]  # a triangle
    tx = np.array([p[0] for p in pairs], dtype=float)
    ty = np.array([p[1] for p in pairs], dtype=float)
    z = tx + ty
    r = gx.grid_xyz(tx, ty, z, method=method, nx=12, ny=12, xlim=(0.0, 4.0), ylim=(0.0, 4.0))
    xx, yy = np.meshgrid(r.x, r.y)
    outside = xx + yy > 4.0 + 1e-9  # beyond the hypotenuse
    assert np.isnan(r.z[outside]).all()
    assert np.isfinite(r.z[(xx + yy < 3.5) & (xx > 0.2) & (yy > 0.2)]).all()
    near = gx.grid_xyz(tx, ty, z, method=method, nx=12, ny=12, xlim=(0.0, 4.0),
                       ylim=(0.0, 4.0), extrapolation="nearest")
    assert np.isfinite(near.z).all()
    inside = ~outside
    assert np.allclose(near.z[inside], r.z[inside], equal_nan=True)


@pytest.mark.parametrize("method", list(gx.GRID_METHODS))
def test_every_method_fails_closed(method: str) -> None:
    with pytest.raises(ValueError):
        gx.grid_xyz([0, 1], [0, 1], [1, 2], method=method)
    line = np.linspace(0, 1, 12)
    with pytest.raises(ValueError):
        gx.grid_xyz(line, 2 * line + 1, line**2, method=method)
    with pytest.raises(ValueError):
        gx.grid_xyz(line, np.full(12, 3.0), line, method=method)


def test_kriging_and_shepard_refuse_too_few_points_for_their_estimator() -> None:
    x = np.array([0.0, 1.0, 0.0, 1.0])
    y = np.array([0.0, 0.0, 1.0, 1.0])
    with pytest.raises(ValueError, match="at least 5"):
        gx.grid_xyz(x, y, x + y, method="kriging")
    with pytest.raises(ValueError, match="at least 7"):
        gx.grid_xyz(x, y, x + y, method="shepard")


def test_log_spaced_axes() -> None:
    x = np.repeat(np.logspace(0, 3, 12), 6)
    y = np.tile(np.linspace(0.1, 10, 6), 12)
    z = np.log10(x) + 0.1 * y
    r = gx.grid_xyz(x, y, z, method="linear", nx=7, ny=5, log_x=True, log_y=True)
    assert np.allclose(np.log10(r.x), np.linspace(0, 3, 7))
    assert np.allclose(np.log10(r.y), np.linspace(-1, 1, 5))
    xx, yy = np.meshgrid(r.x, r.y)
    inner = np.isfinite(r.z)
    assert inner.sum() >= 20
    # linear interpolation of a surface that is linear in y and concave in x
    assert np.max(np.abs(r.z[inner] - (np.log10(xx) + 0.1 * yy)[inner])) < 0.2
    lin = gx.grid_xyz(x, y, z, method="linear", nx=7, ny=5)
    assert not np.allclose(lin.x, r.x)
    k = gx.grid_xyz(x, y, z, method="renka", nx=7, ny=5, log_x=True)
    assert np.allclose(np.log10(k.x), np.linspace(0, 3, 7))


def test_log_axes_need_positive_values() -> None:
    x = np.tile(np.linspace(-1, 1, 6), 6)
    y = np.repeat(np.linspace(1, 2, 6), 6)
    with pytest.raises(ValueError, match="log-spaced x axis"):
        gx.grid_xyz(x, y, x + y, log_x=True)
    with pytest.raises(ValueError, match="log-spaced y axis"):
        gx.grid_xyz(y, x, x + y, log_y=True)
    with pytest.raises(ValueError, match="above 0"):
        gx.grid_xyz(y, x, x + y, log_x=True, xlim=(0.0, 2.0))


@pytest.mark.parametrize("method", ["natural", "linear", "nearest", "cubic", "idw", "thinplate"])
def test_existing_methods_are_bit_identical_to_regrid2d(method: str) -> None:
    s = slice(0, 60)
    z = smooth(X, Y)
    ref = regrid2d(X[s], Y[s], z[s], nx=14, ny=11, method=method)[2]
    got = gx.grid_xyz(X[s], Y[s], z[s], method=method, nx=14, ny=11).z
    assert np.array_equal(ref, got, equal_nan=True)


def test_new_methods_are_reachable_through_regrid2d_for_the_map_tab() -> None:
    for m in ("shepard", "kriging", "renka"):
        _, _, z = regrid2d(X, Y, plane(X, Y), nx=10, ny=10, method=m)
        assert np.isfinite(z).sum() > 40


def test_grid_datastruct_is_a_native_map_with_provenance() -> None:
    r = gx.grid_xyz(X, Y, plane(X, Y), method="kriging", nx=9, ny=8)
    ds = gx.grid_datastruct(r, x_label="H", x_unit="T", y_label="T", y_unit="K", z_unit="V")
    assert ds.metadata["map_grid"] == "native" and ds.metadata["map_shape"] == [8, 9]
    assert ds.metadata["map_op"]["method"] == "kriging"
    assert ds.metadata["map_op"]["variogram"]["model"] in ("spherical", "exponential", "gaussian")
