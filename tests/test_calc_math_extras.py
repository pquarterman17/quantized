"""Analytic tests for the math extras: areas, interpolation, correlation, solver."""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.map_correlate import correlate_maps
from quantized.calc.map_ops import MapGrid
from quantized.calc.math_area import polygon_area, surface_area
from quantized.calc.math_interp import bspline_resample, scattered_interpolate, trace_interpolate
from quantized.calc.math_solve import optimize_box, solve_root


def grid(z: np.ndarray, x: np.ndarray, y: np.ndarray) -> MapGrid:
    return MapGrid(
        x=x, y=y, z=z, x_label="x", x_unit="", y_label="y", y_unit="", z_unit="", metadata={}
    )


# ---- areas -----------------------------------------------------------------


def test_unit_square_area_closed_by_endpoints() -> None:
    r = polygon_area([0, 1, 1, 0], [0, 0, 1, 1])
    assert r.area == pytest.approx(1.0)
    assert r.signed_area == pytest.approx(1.0)  # counter-clockwise
    assert r.perimeter == pytest.approx(4.0)
    assert r.self_intersecting is False


def test_square_already_closed_and_clockwise_and_far_from_origin() -> None:
    x = [1e6, 1e6, 1e6 + 1, 1e6 + 1, 1e6]
    y = [1e6, 1e6 + 1, 1e6 + 1, 1e6, 1e6]
    r = polygon_area(x, y)
    assert r.n_points == 4
    assert r.area == pytest.approx(1.0, rel=1e-9)
    assert r.signed_area == pytest.approx(-1.0, rel=1e-9)


def test_circle_area() -> None:
    t = np.linspace(0, 2 * np.pi, 2000, endpoint=False)
    assert polygon_area(3 * np.cos(t), 3 * np.sin(t)).area == pytest.approx(9 * np.pi, rel=1e-5)


def test_bowtie_is_flagged_self_intersecting() -> None:
    r = polygon_area([0, 1, 0, 1], [0, 1, 1, 0])
    assert r.self_intersecting is True
    assert r.area == pytest.approx(0.0)  # the loops cancel; the flag is the warning


def test_polygon_refuses_bad_input() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        polygon_area([0, 1], [0, 1])
    with pytest.raises(ValueError, match="not finite"):
        polygon_area([0, 1, np.nan, 2], [0, 1, 1, 0])
    assert polygon_area([0, 1, np.nan, 1, 0], [0, 0, 5, 1, 1], nonfinite="drop").dropped == 1


def test_surface_area_of_plane_and_flat() -> None:
    x, y = np.linspace(0, 4, 9), np.linspace(0, 2, 5)
    xx, yy = np.meshgrid(x, y)
    flat = surface_area(grid(np.ones_like(xx), x, y))
    assert flat.surface_area == pytest.approx(8.0)
    assert flat.projected_area == pytest.approx(8.0)
    a, b = 0.5, -1.5
    plane = surface_area(grid(a * xx + b * yy + 3, x, y))
    assert plane.surface_area == pytest.approx(8.0 * math.sqrt(1 + a * a + b * b))


def test_surface_area_of_hemisphere_cap() -> None:
    # z = sqrt(R^2 - x^2 - y^2) over a disc is tricky; use a sphere patch: area = 2 pi R h
    n, r_ = 401, 1.0
    x = y = np.linspace(-0.6, 0.6, n)
    xx, yy = np.meshgrid(x, y)
    z = np.sqrt(r_**2 - xx**2 - yy**2)
    got = surface_area(grid(z, x, y)).surface_area
    # exact: integral of 1/sqrt(1 - r^2) dA over the square; compare to a fine quadrature
    from scipy.integrate import dblquad

    exact = dblquad(lambda b, a: 1 / math.sqrt(1 - a * a - b * b), -0.6, 0.6, -0.6, 0.6)[0]
    assert got == pytest.approx(exact, rel=1e-4)


def test_surface_area_nonuniform_axes_and_blanks() -> None:
    x, y = np.array([0.0, 1.0, 3.0]), np.array([0.0, 2.0])
    z = np.zeros((2, 3))
    assert surface_area(grid(z, x, y)).surface_area == pytest.approx(6.0)
    z[0, 0] = np.nan
    with pytest.raises(ValueError, match="blank"):
        surface_area(grid(z, x, y))
    r = surface_area(grid(z, x, y), on_nan="skip")
    assert (r.skipped_cells, r.n_cells) == (1, 1)
    assert r.surface_area == pytest.approx(4.0)


# ---- interpolation ---------------------------------------------------------


def test_trace_n_points_on_a_circle_is_equal_arc_steps() -> None:
    t = np.linspace(0, 2 * np.pi, 721)
    r = trace_interpolate(np.cos(t), np.sin(t), n=5)
    assert r.total_length == pytest.approx(2 * np.pi, rel=1e-4)
    assert np.allclose(np.diff(r.s), r.total_length / 4)
    assert (r.x[0], r.y[0]) == pytest.approx((1.0, 0.0))
    assert r.x[2] == pytest.approx(-1.0, abs=1e-3)  # half way round


def test_trace_non_monotonic_x_and_spacing() -> None:
    # a path that doubles back in X: (0,0) -> (2,0) -> (2,0) dup -> (1,0)... then up
    r = trace_interpolate([0, 2, 2, 1], [0, 0, 0, 0], spacing=0.5)
    assert r.merged == 1
    assert r.total_length == pytest.approx(3.0)
    assert list(np.round(r.x, 6)) == [0, 0.5, 1, 1.5, 2, 1.5, 1]


def test_trace_at_positions_and_errors() -> None:
    r = trace_interpolate([0, 3], [0, 4], at=[0, 2.5, 5])
    assert list(np.round(r.x, 9)) == [0, 1.5, 3]
    with pytest.raises(ValueError, match="arc length"):
        trace_interpolate([0, 3], [0, 4], at=[6])
    with pytest.raises(ValueError, match="either"):
        trace_interpolate([0, 3], [0, 4])
    with pytest.raises(ValueError, match="finite"):
        trace_interpolate([0, np.nan, 3], [0, 1, 2], n=3)


def test_trace_periodic_cubic_closes_smoothly() -> None:
    t = np.linspace(0, 2 * np.pi, 13)[:-1]
    r = trace_interpolate(np.cos(t), np.sin(t), n=101, kind="cubic", periodic=True)
    assert (r.x[0], r.y[0]) == pytest.approx((r.x[-1], r.y[-1]))


def test_scattered_3d_reproduces_linear_function() -> None:
    rng = np.random.default_rng(1)
    pts = rng.random((200, 3))
    w = 2 * pts[:, 0] - 3 * pts[:, 1] + 0.5 * pts[:, 2] + 1
    q = np.array([[0.5, 0.5, 0.5], [0.3, 0.6, 0.4]])
    for method in ("linear", "rbf"):
        r = scattered_interpolate(pts, w, q, method=method)  # type: ignore[arg-type]
        assert r.w == pytest.approx(2 * q[:, 0] - 3 * q[:, 1] + 0.5 * q[:, 2] + 1, abs=1e-6)


def test_scattered_outside_hull_and_nearest_and_degenerate() -> None:
    pts = np.array([[0, 0], [1, 0], [0, 1], [1, 1.0]])
    w = np.array([0, 1, 2, 3.0])
    out = scattered_interpolate(pts, w, [[0.5, 0.5], [5, 5]])
    assert out.outside == 1 and np.isnan(out.w[1])
    filled = scattered_interpolate(pts, w, [[5, 5]], extrapolation="nearest")
    assert filled.w[0] == 3.0
    with pytest.raises(ValueError, match="collinear|share one"):
        scattered_interpolate([[0, 0], [1, 1], [2, 2]], [0, 1, 2], [[0.5, 0.5]])
    with pytest.raises(ValueError, match="coordinates"):
        scattered_interpolate(pts, w, [[0.5, 0.5, 0.5]])


def test_scattered_merges_duplicates_by_mean() -> None:
    pts = [[0, 0], [0, 0], [1, 0], [0, 1.0]]
    r = scattered_interpolate(pts, [1, 3, 0, 0], [[0, 0]], method="nearest")
    assert (r.merged, r.w[0]) == (1, 2.0)


def test_bspline_n_points_spacing_and_smoothing() -> None:
    x = np.linspace(0, 2 * np.pi, 40)
    r = bspline_resample(x, np.sin(x), n=200)
    assert r.x.size == 200
    assert np.max(np.abs(r.y - np.sin(r.x))) < 1e-4
    s = bspline_resample(x, np.sin(x), spacing=0.1)
    assert s.x[1] - s.x[0] == pytest.approx(0.1)
    rng = np.random.default_rng(0)
    noisy = np.sin(x) + rng.normal(0, 0.05, x.size)
    smooth = bspline_resample(x, noisy, n=50, smoothing=0.1)
    assert smooth.residual <= 0.1 * 1.01
    assert bspline_resample(x, noisy, n=50).residual < 1e-12


def test_bspline_refuses() -> None:
    with pytest.raises(ValueError, match="needs at least"):
        bspline_resample([0, 1, 2], [0, 1, 4], n=5)
    with pytest.raises(ValueError, match="either"):
        bspline_resample([0, 1, 2, 3], [0, 1, 4, 9], n=5, spacing=1)


# ---- correlation -----------------------------------------------------------


def gaussian(x0: float, y0: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    xx, yy = np.meshgrid(x, y)
    return np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2 * 1.5**2))


def test_correlation_peak_recovers_shift() -> None:
    x, y = np.arange(40, dtype=float), np.arange(30, dtype=float)
    a = grid(gaussian(20 + 4, 15 - 3, x, y), x, y)
    b = grid(gaussian(20, 15, x, y), x, y)
    out, peak = correlate_maps(a, b)
    assert (peak.offset_x, peak.offset_y) == pytest.approx((4.0, -3.0), abs=0.05)
    assert (peak.lag_x, peak.lag_y) == (4, -3)
    assert 0.9 < peak.value <= 1.0
    assert out.z.shape == (59, 79)
    assert out.x[0] == -39.0 and out.z.max() == pytest.approx(peak.value)


def test_correlation_self_is_one_and_subpixel() -> None:
    x, y = np.arange(40, dtype=float), np.arange(40, dtype=float)
    g = grid(gaussian(20, 20, x, y), x, y)
    _, p = correlate_maps(g, g)
    assert p.value == pytest.approx(1.0) and p.offset_x == pytest.approx(0, abs=1e-9)
    _, q = correlate_maps(grid(gaussian(20.5, 20, x, y), x, y), g)
    assert q.offset_x == pytest.approx(0.5, abs=0.02)
    _, nq = correlate_maps(grid(gaussian(20.5, 20, x, y), x, y), g, subpixel=False)
    assert nq.offset_x in (0.0, 1.0)


def test_correlation_uses_axis_units_and_origin() -> None:
    x = 10 + 0.5 * np.arange(40)
    y = np.arange(30, dtype=float)
    a = grid(gaussian(14, 15, x, y), x, y)
    b = grid(gaussian(12, 15, x, y), x, y)
    _, p = correlate_maps(a, b)
    assert p.lag_x == 4  # 2 axis units = 4 cells of 0.5
    assert p.offset_x == pytest.approx(2.0, abs=0.15)  # whole-map mean removal biases it slightly


def test_correlation_refusals() -> None:
    x, y = np.arange(10.0), np.arange(10.0)
    g = grid(gaussian(5, 5, x, y), x, y)
    with pytest.raises(ValueError, match="cell sizes"):
        correlate_maps(g, grid(g.z, x * 2, y))
    with pytest.raises(ValueError, match="constant"):
        correlate_maps(g, grid(np.ones((10, 10)), x, y))
    holed = g.z.copy()
    holed[0, 0] = np.nan
    with pytest.raises(ValueError, match="blank"):
        correlate_maps(grid(holed, x, y), g)
    assert correlate_maps(grid(holed, x, y), g, on_nan="zero")[1].blank_cells == 1


# ---- solver ----------------------------------------------------------------


def test_root_known_roots() -> None:
    r = solve_root("x^2 - 2", 0, 3)
    assert r.roots == pytest.approx([math.sqrt(2)], abs=1e-12)
    two = solve_root("sin(x)", 1, 7)
    assert two.roots == pytest.approx([math.pi, 2 * math.pi], abs=1e-10)


def test_root_constants_target_and_endpoint_zero() -> None:
    assert solve_root("a*x - b", -10, 10, {"a": 2, "b": 3}).roots == pytest.approx([1.5])
    assert solve_root("x^2", 1, 3, target=4).roots == pytest.approx([2.0])
    assert solve_root("x", 0, 1).roots == [0.0]


def test_root_ignores_pole_and_refuses() -> None:
    with pytest.raises(ValueError, match="no sign change") as e:
        solve_root("1/x", -1, 2)
    assert "pole" in str(e.value)
    with pytest.raises(ValueError, match="give a value for: a"):
        solve_root("a*x", 0, 1)
    with pytest.raises(ValueError, match="no name b"):
        solve_root("x", 0, 1, {"b": 1})
    with pytest.raises(ValueError, match="does not use x"):
        solve_root("5", 0, 1)
    with pytest.raises(ValueError, match="lo < hi"):
        solve_root("x", 1, 0)
    with pytest.raises(ValueError):
        solve_root("x +", 0, 1)
    with pytest.raises(ValueError, match="no sign change"):
        solve_root("x^2 + 1", -1, 1)


def test_optimize_known_minimum_and_maximum() -> None:
    r = optimize_box("(x-1)^2 + (a+2)^2 + 3", {"x": (-5, 5), "a": (-5, 5)})
    assert r.variables == ["x", "a"]
    assert r.point == pytest.approx([1.0, -2.0], abs=1e-5)
    assert r.value == pytest.approx(3.0, abs=1e-9)
    assert r.at_bound == []
    m = optimize_box("-(x-1)^2", {"x": (-5, 5)}, sense="max")
    assert m.point == pytest.approx([1.0], abs=1e-5) and m.value == pytest.approx(0.0, abs=1e-9)


def test_optimize_box_active_bound_multistart_and_refusals() -> None:
    r = optimize_box("x", {"x": (2, 5)})
    assert r.point == pytest.approx([2.0]) and r.at_bound == ["x"]
    # two basins: the global one is at x = -2 (deeper); restarts must find it
    w = optimize_box("(x^2-4)^2 + x", {"x": (-3, 3)}, starts=12)
    assert w.point[0] == pytest.approx(-2.0, abs=0.05)
    assert w.starts == 12
    with pytest.raises(ValueError, match="give bounds for: a"):
        optimize_box("x + a", {"x": (0, 1)})
    with pytest.raises(ValueError, match="no variable b"):
        optimize_box("x", {"x": (0, 1), "b": (0, 1)})
    with pytest.raises(ValueError, match="lower < upper"):
        optimize_box("x", {"x": (1, 1)})
    with pytest.raises(ValueError, match="not finite"):
        optimize_box("log(x)", {"x": (-2, -1)})
