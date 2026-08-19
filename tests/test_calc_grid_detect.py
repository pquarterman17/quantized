"""Regular-grid detection (calc/_grid_detect.py) -- P2.8 map-regrid fast path.

White-box tests of the detection primitives themselves (not through
``interpolate2d``/``regrid2d``'s public surface -- those differential tests
live in ``test_calc_interp2d.py``). Mirrors the pattern used for other
private calc helpers (``_natural_neighbor``, ``_delimited_layout``, ...).
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc._grid_detect import GridLayout, detect_regular_grid, grid_to_zarray


def _mesh(xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Flatten an outer product, matching io/xrdml.py's ``_build_2d`` shape."""
    x, y = np.meshgrid(xs, ys, indexing="xy")
    return x.ravel(), y.ravel()


# ── accept: exact and near-exact grids ─────────────────────────────────────


def test_detects_exact_grid() -> None:
    x, y = _mesh(np.linspace(0.0, 10.0, 11), np.linspace(0.0, 5.0, 6))
    grid = detect_regular_grid(x, y)
    assert grid is not None
    assert grid.nx == 11
    assert grid.ny == 6
    np.testing.assert_allclose(grid.ux, np.linspace(0.0, 10.0, 11))
    np.testing.assert_allclose(grid.uy, np.linspace(0.0, 5.0, 6))


def test_detects_grid_with_missing_cells_above_coverage_floor() -> None:
    # Dead-pixel-style dropout: drop 5% of combinations at random.
    x, y = _mesh(np.linspace(0.0, 10.0, 20), np.linspace(0.0, 5.0, 15))
    rng = np.random.default_rng(1)
    keep = rng.random(x.size) > 0.05
    grid = detect_regular_grid(x[keep], y[keep])
    assert grid is not None
    assert grid.nx == 20
    assert grid.ny == 15


def test_rejects_sparse_incomplete_grid_below_coverage_floor() -> None:
    # Only 5 of the 9 cells of a 3x3 grid: uniformly-spaced axis values, but
    # far too sparse to be dead-pixel dropout on a real map -- also protects
    # the existing corners+centre unit-square fixture used by
    # test_calc_map.py / test_calc_interp2d.py (a plane-reproduction test at
    # rtol=1e-9 that must keep taking the exact scattered path).
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    assert detect_regular_grid(x, y) is None


@pytest.mark.parametrize("keep_frac", [0.85, 0.89])
def test_rejects_just_below_coverage_floor(keep_frac: float) -> None:
    x, y = _mesh(np.linspace(0.0, 10.0, 20), np.linspace(0.0, 5.0, 20))
    n_keep = int(round(x.size * keep_frac))
    rng = np.random.default_rng(2)
    idx = rng.choice(x.size, size=n_keep, replace=False)
    assert detect_regular_grid(x[idx], y[idx]) is None


@pytest.mark.parametrize("keep_frac", [0.92, 0.97])
def test_detects_just_above_coverage_floor(keep_frac: float) -> None:
    x, y = _mesh(np.linspace(0.0, 10.0, 20), np.linspace(0.0, 5.0, 20))
    n_keep = int(round(x.size * keep_frac))
    rng = np.random.default_rng(3)
    idx = rng.choice(x.size, size=n_keep, replace=False)
    assert detect_regular_grid(x[idx], y[idx]) is not None


def test_detects_grid_with_per_point_float_jitter() -> None:
    # Adversarial: every point (not just every line) gets independent noise,
    # so the same nominal grid line is represented by many close-but-not-
    # equal raw values -- exercises the jitter/pitch bimodal split under the
    # worst case (many small gaps swamping the true pitch estimate).
    x, y = _mesh(np.linspace(0.0, 10.0, 11), np.linspace(0.0, 5.0, 6))
    rng = np.random.default_rng(4)
    jx = x + rng.normal(scale=1e-8, size=x.size)
    jy = y + rng.normal(scale=1e-8, size=y.size)
    grid = detect_regular_grid(jx, jy)
    assert grid is not None
    assert grid.nx == 11
    assert grid.ny == 6
    np.testing.assert_allclose(grid.ux, np.linspace(0.0, 10.0, 11), atol=1e-6)


def test_detects_grid_with_per_line_float_jitter() -> None:
    # Realistic case: each grid line's position drifts by a small, shared
    # amount (e.g. a per-scan linspace(tt_start, tt_end, ...) where
    # tt_start/tt_end differ by encoder noise between scans that are
    # nominally the same window -- io/xrdml.py's `_is_2d` already tolerates
    # this at 1e-4 deg). Every point on a line shares that line's offset.
    xs, ys = np.linspace(0.0, 10.0, 11), np.linspace(0.0, 5.0, 6)
    xg, yg = np.meshgrid(xs, ys, indexing="xy")
    rng = np.random.default_rng(5)
    xg = xg + rng.normal(scale=1e-4, size=xs.size)[None, :]
    yg = yg + rng.normal(scale=1e-4, size=ys.size)[:, None]
    grid = detect_regular_grid(xg.ravel(), yg.ravel())
    assert grid is not None
    assert grid.nx == 11
    assert grid.ny == 6


def test_detects_grid_with_6dp_representable_pitch() -> None:
    # Sanity/regression guard for the quantization fix below: a pitch that
    # IS exactly representable at 6 decimal places has zero rounding jitter,
    # so it must keep hitting regardless of how the tolerance is computed.
    n, pitch, start = 1000, 0.0008, 20.0
    om = np.round(np.arange(n) * pitch + start, 6)
    tt = np.round(np.arange(n) * pitch + 40.0, 6)
    x, y = _mesh(tt, om)
    grid = detect_regular_grid(x, y)
    assert grid is not None
    assert grid.nx == n
    assert grid.ny == n


def test_detects_grid_with_non_representable_pitch_quantization_1000() -> None:
    # Real instrument export: angular positions are written as decimal text
    # at 6 places (tools/baselines/rsm.py, every committed .xrdml fixture).
    # A pitch that is NOT itself 6dp-representable (0.00083333...) means each
    # coordinate's rounding to the nearest 1e-6 injects up to ~5e-7 absolute
    # error, independent of the pitch -- so at this fine a pitch the RELATIVE
    # jitter (~1.2e-3) exceeds the old purely-relative _SPACING_RTOL (1e-3)
    # even though the grid is perfectly real. Must detect.
    n, pitch, start = 1000, 0.00083333, 20.00007
    om = np.round(np.arange(n) * pitch + start, 6)
    tt = np.round(np.arange(n) * pitch + 40.0, 6)
    x, y = _mesh(tt, om)
    grid = detect_regular_grid(x, y)
    assert grid is not None
    assert grid.nx == n
    assert grid.ny == n


def test_detects_grid_with_non_representable_pitch_quantization_2000() -> None:
    # Same as above but finer pitch (0.00041667) -> the same ~5e-7 absolute
    # quantization error is now a LARGER fraction of pitch (~2.4e-3 relative)
    # -- demonstrating the old relative-only test gets WORSE, not better, as
    # the grid gets finer (exactly backwards: fine pitch = big map = the case
    # that most needs the fast path). Must detect.
    n, pitch, start = 2000, 0.00041667, 20.00007
    om = np.round(np.arange(n) * pitch + start, 6)
    tt = np.round(np.arange(n) * pitch + 40.0, 6)
    x, y = _mesh(tt, om)
    grid = detect_regular_grid(x, y)
    assert grid is not None
    assert grid.nx == n
    assert grid.ny == n


# ── reject: not actually a grid ────────────────────────────────────────────


def test_rejects_scattered_data() -> None:
    rng = np.random.default_rng(6)
    x = rng.uniform(0.0, 10.0, 300)
    y = rng.uniform(0.0, 5.0, 300)
    assert detect_regular_grid(x, y) is None


def test_rejects_log_spaced_axis() -> None:
    x, y = _mesh(np.logspace(0.0, 2.0, 20), np.linspace(0.0, 5.0, 10))
    assert detect_regular_grid(x, y) is None


def test_rejects_two_merged_grids_different_spacing() -> None:
    ys = np.linspace(0.0, 5.0, 6)
    x1, y1 = _mesh(np.linspace(0.0, 5.0, 11), ys)  # pitch 0.5
    x2, y2 = _mesh(np.linspace(5.6, 10.0, 9), ys)  # pitch 0.55, offset start
    x = np.concatenate([x1, x2])
    y = np.concatenate([y1, y2])
    assert detect_regular_grid(x, y) is None


def test_rejects_log_spaced_axis_with_6dp_quantization() -> None:
    # Same rejection as test_rejects_log_spaced_axis, but with the axis
    # additionally rounded to 6dp the way a real instrument export would
    # write it -- proves the new quantum-derived absolute term doesn't
    # accidentally rescue a log axis just because its *values* happen to sit
    # on a 1e-6 lattice. The pitch itself is still wildly non-uniform
    # (spans orders of magnitude), which no plausible quantum-based
    # absolute tolerance should paper over.
    x, y = _mesh(np.round(np.logspace(0.0, 2.0, 20), 6), np.linspace(0.0, 5.0, 10))
    assert detect_regular_grid(x, y) is None


def test_rejects_genuinely_irregular_axis_beyond_quantization_bound() -> None:
    # A coarse-pitch axis (median pitch 0.01, well above the 1e-6 coordinate
    # quantum) with a deliberate, real pitch defect of 5e-5 -- 50x the
    # coordinate quantum and 5e-3 relative to the pitch, i.e. far past both
    # _SPACING_RTOL*pitch and any reasonable k*q absolute term. This is not
    # instrument quantization noise, it's a genuinely irregular axis (e.g. a
    # dropped/duplicated step), and must keep being rejected -- proves the
    # fix didn't just widen the tolerance until everything passes.
    xs = np.round(np.arange(21) * 0.01 + 40.0, 6)
    xs[10:] += 5e-5  # a real, physical pitch jump partway through the axis
    ys = np.linspace(0.0, 5.0, 10)
    x, y = _mesh(xs, ys)
    assert detect_regular_grid(x, y) is None


def test_rejects_single_row() -> None:
    x = np.linspace(0.0, 10.0, 20)
    y = np.full(20, 3.0)
    assert detect_regular_grid(x, y) is None


def test_rejects_single_column() -> None:
    y = np.linspace(0.0, 10.0, 20)
    x = np.full(20, 3.0)
    assert detect_regular_grid(x, y) is None


def test_rejects_too_few_points() -> None:
    assert detect_regular_grid(np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])) is None


def test_rejects_mismatched_lengths() -> None:
    assert detect_regular_grid(np.zeros(5), np.zeros(4)) is None


# ── grid_to_zarray ──────────────────────────────────────────────────────────


def test_grid_to_zarray_places_values_and_leaves_nan_holes() -> None:
    x, y = _mesh(np.array([0.0, 1.0, 2.0]), np.array([0.0, 1.0]))
    z = np.array([10.0, 11.0, 12.0, 13.0, 14.0, 15.0])
    # Drop the (x=1, y=0) cell to create a hole.
    keep = np.array([True, False, True, True, True, True])
    grid = detect_regular_grid(x[keep], y[keep], min_coverage=0.5)
    assert grid is not None
    zg = grid_to_zarray(grid, z[keep])
    assert zg.shape == (2, 3)
    assert np.isnan(zg[0, 1])
    assert np.isfinite(zg).sum() == 5


def test_grid_to_zarray_keeps_first_occurrence_on_collision() -> None:
    # Two points map to the same cell (exact duplicate coordinates); the
    # FIRST z value wins, mirroring interp2d._unique_rows's MATLAB
    # unique('stable') convention.
    z = np.array([1.0, 2.0, 3.0, 4.0, 999.0])  # last point duplicates the first
    layout = GridLayout(
        ux=np.array([0.0, 1.0]),
        uy=np.array([0.0, 1.0]),
        ix=np.array([0, 1, 0, 1, 0]),
        iy=np.array([0, 0, 1, 1, 0]),
    )
    zg = grid_to_zarray(layout, z)
    assert zg[0, 0] == pytest.approx(1.0)  # not 999.0
