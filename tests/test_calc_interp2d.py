"""interpolate2D + regrid2D: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from scipy.interpolate import griddata

from quantized.calc._grid_detect import detect_regular_grid
from quantized.calc.interp2d import interpolate2d, regrid2d


def _scattered(g: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    inp = g["input"]
    return (
        np.asarray(inp["x"], dtype=float),
        np.asarray(inp["y"], dtype=float),
        np.asarray(inp["z"], dtype=float),
    )


@pytest.mark.golden
@pytest.mark.parametrize("method", ["linear", "natural", "idw", "thinplate"])
def test_interpolate2d_matches_matlab(
    method: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_interp2d_{method}.json")
    x, y, z = _scattered(g)
    xq = np.asarray(g["input"]["xq"], dtype=float)
    yq = np.asarray(g["input"]["yq"], dtype=float)
    out = interpolate2d(x, y, z, xq, yq, method=method)
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_regrid2d_idw_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_regrid_idw.json")
    x, y, z = _scattered(g)
    xq, yq, zq = regrid2d(x, y, z, nx=8, ny=8, method="idw")
    np.testing.assert_allclose(xq, np.asarray(g["output"]["Xq"], dtype=float), rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(yq, np.asarray(g["output"]["Yq"], dtype=float), rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(zq, np.asarray(g["output"]["Zq"], dtype=float), rtol=1e-9, atol=1e-9)


def test_interpolate2d_nearest_returns_node_values() -> None:
    # Nearest-neighbour matches MATLAB except at Voronoi-cell boundaries (tie-break
    # differs between scipy KDTree and MATLAB scatteredInterpolant), so it is tested
    # structurally: every result is one of the input node values.
    x = np.array([0.1, 0.9, 0.5, 0.2, 0.8, 0.4])
    y = np.array([0.2, 0.3, 0.8, 0.6, 0.7, 0.1])
    z = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    xq, yq = np.meshgrid(np.linspace(0.2, 0.8, 4), np.linspace(0.2, 0.8, 4))
    out = interpolate2d(x, y, z, xq, yq, method="nearest")["zq"]
    assert set(np.unique(out[~np.isnan(out)])).issubset(set(z.tolist()))


def test_interpolate2d_idw_reproduces_nodes() -> None:
    # IDW returns the exact node value when queried at a data point.
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 9.0])
    out = interpolate2d(x, y, z, np.array([0.5]), np.array([0.5]), method="idw")
    assert out["zq"][0] == pytest.approx(9.0)


# ── Sibson natural-neighbour (calc/_natural_neighbor) ─────────────────────────


def test_natural_has_linear_precision() -> None:
    # Sibson interpolation reproduces any affine field z = a*x + b*y + c exactly.
    rng = np.random.default_rng(0)
    x = rng.uniform(0, 4, 60)
    y = rng.uniform(0, 4, 60)
    z = 2.0 * x + 3.0 * y + 1.0
    gx, gy = np.meshgrid(np.linspace(1, 3, 11), np.linspace(1, 3, 11))
    zq = interpolate2d(x, y, z, gx, gy, method="natural")["zq"]
    assert np.isfinite(zq).all()
    np.testing.assert_allclose(zq, 2.0 * gx + 3.0 * gy + 1.0, atol=1e-9)


def test_natural_reproduces_nodes() -> None:
    # Querying exactly at a data node returns that node's value (degenerate cell).
    x = np.array([0.1, 0.9, 0.5, 0.2, 0.8, 0.4])
    y = np.array([0.2, 0.3, 0.8, 0.6, 0.7, 0.1])
    z = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    # Node index 2 is (0.5, 0.8) with z = 3.0.
    out = interpolate2d(x, y, z, np.array([0.5]), np.array([0.8]), method="natural")
    assert out["zq"][0] == pytest.approx(3.0)


def test_cubic_aliases_to_natural() -> None:
    # MATLAB scatteredInterpolant has no 'cubic'; it aliases to 'natural'.
    rng = np.random.default_rng(1)
    x = rng.uniform(0, 4, 40)
    y = rng.uniform(0, 4, 40)
    z = np.sin(x) * np.cos(y)
    gx, gy = np.meshgrid(np.linspace(1, 3, 7), np.linspace(1, 3, 7))
    a = interpolate2d(x, y, z, gx, gy, method="natural")["zq"]
    b = interpolate2d(x, y, z, gx, gy, method="cubic")["zq"]
    np.testing.assert_array_equal(a, b)


def test_natural_nan_outside_hull() -> None:
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 2.5])
    out = interpolate2d(x, y, z, np.array([[5.0]]), np.array([[5.0]]), method="natural")
    assert np.isnan(out["zq"][0, 0])


def test_natural_collinear_returns_nan() -> None:
    # Collinear data cannot be triangulated → all NaN (matches MATLAB natural).
    x = np.array([0.0, 1.0, 2.0, 3.0])
    y = np.array([0.0, 1.0, 2.0, 3.0])
    z = np.array([0.0, 1.0, 4.0, 9.0])
    out = interpolate2d(x, y, z, np.array([1.5]), np.array([1.5]), method="natural")
    assert np.isnan(out["zq"][0])


def test_interpolate2d_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        interpolate2d([0.0, 1.0], [0.0, 1.0], [0.0, 1.0], [0.5], [0.5])


def test_thinplate_singular_raises_valueerror() -> None:
    # Collinear data (all points on y = x) makes the thin-plate system singular;
    # it must surface as a clean ValueError, not an unhandled LinAlgError.
    x = np.array([0.0, 1.0, 2.0, 3.0])
    y = np.array([0.0, 1.0, 2.0, 3.0])
    z = np.array([0.0, 1.0, 4.0, 9.0])
    with pytest.raises(ValueError, match="singular"):
        interpolate2d(x, y, z, np.array([1.5]), np.array([1.5]), method="thinplate")


def test_regrid2d_shape_and_extent() -> None:
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 2.5])
    xq, yq, zq = regrid2d(x, y, z, nx=10, ny=6, method="idw")
    assert xq.shape == (6, 10)
    assert zq.shape == (6, 10)
    assert xq.min() == pytest.approx(0.0)
    assert xq.max() == pytest.approx(1.0)


# ── robustness: real-world scattered data with NaN gaps (corpus audit) ────────


def test_regrid2d_drops_nonfinite_triples() -> None:
    """A NaN in x, y, or z drops that triple instead of crashing the grid.

    scatteredInterpolant/griddata reject non-finite nodes; real instrument maps
    have NaN gaps, so regrid2d must filter them and still grid the finite rest.
    """
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5, np.nan])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 2.5, 7.0])
    xq, yq, zq = regrid2d(x, y, z, nx=8, ny=8, method="idw")
    assert xq.shape == (8, 8)
    # The auto-extent comes from the finite x only (max 1.0), not the NaN.
    assert xq.max() == pytest.approx(1.0)
    assert np.isfinite(zq).any()


def test_regrid2d_constant_axis_reports_clearly() -> None:
    """A constant y axis (1-D profile mis-mapped as 2-D) gives a clear error."""
    x = np.array([0.0, 1.0, 2.0, 3.0])
    y = np.array([5.0, 5.0, 5.0, 5.0])  # no range
    z = np.array([1.0, 2.0, 3.0, 4.0])
    with pytest.raises(ValueError, match="y axis has no range"):
        regrid2d(x, y, z, nx=8, ny=8, method="idw")


# ── P2.8 gridded-input fast path (calc/_grid_detect.py) ────────────────────
#
# The default `method="linear"` path used to Delaunay-triangulate the FULL
# input cloud on every call (scipy.interpolate.griddata) regardless of
# output resolution -- 8.5/37/153s at 250k/1M/4M points, see
# docs/envelope/2026-07-27-final-residuals.json and
# tools/baselines/measure_map_regrid.py. Real 2-D maps (XRD/RSM meshes, see
# io/xrdml.py's _build_2d) are usually already a regular grid, so
# interpolate2d(method="linear") now detects that and resamples directly
# (calc/_grid_detect.py) instead of triangulating. These tests are
# differential: scattered input must produce IDENTICAL output to the
# pre-existing griddata call (the fast path never engages); gridded input
# must match a direct griddata(method="linear") reference within a
# documented tolerance (the two are different piecewise-linear
# reconstructions -- bilinear-on-a-grid vs Delaunay-diagonal-linear -- that
# agree exactly on affine fields and closely on smooth ones).


def test_linear_scattered_input_takes_the_old_path_unchanged() -> None:
    """Genuinely scattered data never engages the grid fast path.

    detect_regular_grid must reject it, and interpolate2d's output must
    match scipy.interpolate.griddata called directly -- byte for byte, not
    just "close" -- proving the new dispatch didn't perturb the existing
    code path at all.
    """
    rng = np.random.default_rng(42)
    x = rng.uniform(0.0, 10.0, 300)
    y = rng.uniform(0.0, 6.0, 300)
    z = np.sin(x * 0.7) * np.cos(y * 0.5)
    assert detect_regular_grid(x, y) is None

    qx = np.linspace(1.0, 9.0, 15)
    qy = np.linspace(1.0, 5.0, 12)
    gx, gy = np.meshgrid(qx, qy)

    got = interpolate2d(x, y, z, gx, gy, method="linear")["zq"]
    want = griddata(
        np.column_stack([x, y]), z, np.column_stack([gx.ravel(), gy.ravel()]), method="linear"
    ).reshape(gx.shape)
    np.testing.assert_array_equal(got, want)


def test_linear_full_grid_reproduces_plane_exactly() -> None:
    """A real (dense, not sparse) regular grid takes the fast path and, for
    an affine field, matches the old Delaunay-linear path to machine
    precision -- both are piecewise-linear reconstructions that reproduce a
    plane exactly regardless of which diagonal/lookup scheme they use.
    """
    xs = np.linspace(0.0, 10.0, 12)
    ys = np.linspace(0.0, 6.0, 9)
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    x, y = gx.ravel(), gy.ravel()
    z = 2.0 * x + 3.0 * y + 1.0
    assert detect_regular_grid(x, y) is not None  # confirms this test exercises the fast path

    qx = np.linspace(0.5, 9.5, 20)
    qy = np.linspace(0.5, 5.5, 15)
    qgx, qgy = np.meshgrid(qx, qy)
    zq = interpolate2d(x, y, z, qgx, qgy, method="linear")["zq"]
    np.testing.assert_allclose(zq, 2.0 * qgx + 3.0 * qgy + 1.0, rtol=1e-9, atol=1e-9)


def test_linear_full_grid_matches_old_path_within_documented_tolerance() -> None:
    """A dense regular grid + a smooth (non-affine) field: the fast path and
    a direct griddata(method="linear") reference diverge only by the
    within-cell reconstruction difference (bilinear vs Delaunay-diagonal),
    measured at ~4e-3 absolute for this fixture; atol=0.02 keeps a >4x
    margin without being loose enough to hide a real regression.
    """
    xs = np.linspace(0.0, 10.0, 40)
    ys = np.linspace(0.0, 6.0, 30)
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    x, y = gx.ravel(), gy.ravel()
    z = np.sin(x * 0.7) * np.cos(y * 0.5) + 0.05 * x
    assert detect_regular_grid(x, y) is not None

    qx = np.linspace(0.5, 9.5, 25)
    qy = np.linspace(0.5, 5.5, 20)
    qgx, qgy = np.meshgrid(qx, qy)

    fast = interpolate2d(x, y, z, qgx, qgy, method="linear")["zq"]
    old = griddata(
        np.column_stack([x, y]), z, np.column_stack([qgx.ravel(), qgy.ravel()]), method="linear"
    ).reshape(qgx.shape)
    np.testing.assert_allclose(fast, old, atol=0.02)


def test_linear_grid_with_nan_holes_no_crash_and_dense_region_matches() -> None:
    """Sparse missing cells (dead pixels): the fast path still engages,
    produces the right shape, and doesn't crash. Near a hole it legitimately
    diverges from the old path -- the old path bridges the gap via
    triangulation with neighbouring points, the fast path blocks
    interpolation across a missing grid cell (see interp2d._query_grid_linear's
    docstring) -- so only structural invariants are asserted for the region
    touching holes; the query points far from any hole must still match the
    old path closely, same as the no-holes case above.
    """
    xs = np.linspace(0.0, 10.0, 25)
    ys = np.linspace(0.0, 6.0, 20)
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    x, y = gx.ravel(), gy.ravel()
    z = np.sin(x * 0.7) * np.cos(y * 0.5) + 0.05 * x

    rng = np.random.default_rng(7)
    keep = rng.random(x.size) > 0.03  # ~3% dead-pixel dropout, well above the coverage floor
    xk, yk, zk = x[keep], y[keep], z[keep]
    assert detect_regular_grid(xk, yk) is not None

    # Query far from the (x, y) extremes and away from the axis grid lines
    # themselves, at a resolution coarse enough that most query cells' 4
    # surrounding input nodes are still all finite despite the 3% dropout.
    qx = np.linspace(2.0, 8.0, 13)
    qy = np.linspace(1.5, 4.5, 11)
    qgx, qgy = np.meshgrid(qx, qy)

    fast = interpolate2d(xk, yk, zk, qgx, qgy, method="linear")["zq"]
    assert fast.shape == qgx.shape
    old = griddata(
        np.column_stack([xk, yk]), zk, np.column_stack([qgx.ravel(), qgy.ravel()]), method="linear"
    ).reshape(qgx.shape)
    # Most cells (away from the sparse holes) still match closely; a small
    # minority near a dropped pixel legitimately differ (see docstring), so
    # this checks the majority rather than every cell.
    close = np.abs(fast - old) <= 0.05
    both_finite = np.isfinite(fast) & np.isfinite(old)
    assert both_finite.mean() > 0.8
    assert (close[both_finite]).mean() > 0.85


def test_regrid2d_linear_on_realistic_mesh_shape() -> None:
    """End-to-end through regrid2d (the actual P2.8 call site): a mesh shaped
    like io/xrdml.py's flattened RSM (np.meshgrid(...).ravel()) regridded
    onto a coarser output, same as calc/map.build_map does for the UI.
    """
    tt = np.linspace(40.0, 44.0, 60)
    omega = np.linspace(20.5, 21.3, 45)
    tt_grid, omega_grid = np.meshgrid(tt, omega, indexing="ij")
    x, y = tt_grid.ravel(), omega_grid.ravel()
    z = 4000.0 * np.exp(-0.5 * (((x - 42.0) / 0.35) ** 2 + ((y - 20.9) / 0.10) ** 2)) + 12.0
    assert detect_regular_grid(x, y) is not None

    xq, yq, zq = regrid2d(x, y, z, nx=30, ny=25, method="linear")
    assert zq.shape == (25, 30)
    assert np.isfinite(zq).all()  # output grid sits fully inside the input's rectangular hull
    assert zq.max() == pytest.approx(4012.0, rel=0.05)  # near the Gaussian peak
