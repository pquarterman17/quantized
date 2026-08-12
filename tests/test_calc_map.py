"""MapData + build_map + map_from_datastruct (calc/map.py).

The interpolation itself is golden-tested in ``test_calc_interp2d``; here we
test the 2-D map *contract* (shape validation, axis/grid wiring, nan-aware
colour range, DataStruct column extraction, serialization). The one numeric
assertion uses a linear field ``z = 2x + 3y + 1`` — barycentric ``linear``
interpolation reproduces a linear function exactly inside the convex hull, so
the expected grid is known without a golden freeze.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.map import (
    _AUTO_LINEAR_MIN_POINTS,
    MapData,
    MapState,
    _resolve_auto_method,
    build_map,
    map_from_datastruct,
)
from quantized.datastruct import DataStruct

# Unit-square corners + centre: convex hull is exactly [0,1]×[0,1].
_X = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
_Y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])


def _plane(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return 2.0 * x + 3.0 * y + 1.0


# ── MapData contract ──────────────────────────────────────────────────────
def test_mapdata_shape_and_axes() -> None:
    z = np.arange(12.0).reshape(3, 4)  # (ny=3, nx=4)
    m = MapData(x_axis=np.arange(4.0), y_axis=np.arange(3.0), z_grid=z)
    assert m.nx == 4
    assert m.ny == 3
    assert m.z_grid.shape == (3, 4)


def test_mapdata_rejects_non_2d_grid() -> None:
    with pytest.raises(ValueError, match="z_grid must be 2-D"):
        MapData(x_axis=np.arange(4.0), y_axis=np.arange(3.0), z_grid=np.arange(4.0))


def test_mapdata_rejects_axis_grid_mismatch() -> None:
    z = np.zeros((3, 4))
    with pytest.raises(ValueError, match="x_axis length"):
        MapData(x_axis=np.arange(5.0), y_axis=np.arange(3.0), z_grid=z)
    with pytest.raises(ValueError, match="y_axis length"):
        MapData(x_axis=np.arange(4.0), y_axis=np.arange(2.0), z_grid=z)


def test_mapdata_arrays_are_read_only() -> None:
    m = MapData(x_axis=np.arange(4.0), y_axis=np.arange(3.0), z_grid=np.zeros((3, 4)))
    with pytest.raises(ValueError):
        m.z_grid[0, 0] = 1.0
    with pytest.raises(ValueError):
        m.x_axis[0] = 1.0


def test_mapdata_z_range_ignores_nan() -> None:
    z = np.array([[1.0, np.nan, 3.0], [np.nan, 5.0, np.nan]])
    m = MapData(x_axis=np.arange(3.0), y_axis=np.arange(2.0), z_grid=z)
    assert m.z_min == pytest.approx(1.0)
    assert m.z_max == pytest.approx(5.0)


def test_mapdata_z_range_all_nan_is_nan() -> None:
    z = np.full((2, 3), np.nan)
    m = MapData(x_axis=np.arange(3.0), y_axis=np.arange(2.0), z_grid=z)
    assert np.isnan(m.z_min)
    assert np.isnan(m.z_max)


def test_mapdata_to_dict_structure() -> None:
    m = MapData(
        x_axis=np.array([0.0, 1.0]),
        y_axis=np.array([0.0, 1.0]),
        z_grid=np.array([[1.0, 2.0], [3.0, 4.0]]),
        x_label="Qx",
        x_unit="1/A",
        z_label="I",
        z_unit="cps",
    )
    d = m.to_dict()
    assert d["x_axis"] == [0.0, 1.0]
    assert d["z_grid"] == [[1.0, 2.0], [3.0, 4.0]]
    assert d["x"] == {"label": "Qx", "unit": "1/A"}
    assert d["z"]["label"] == "I"
    assert d["z"]["min"] == pytest.approx(1.0)
    assert d["z"]["max"] == pytest.approx(4.0)


# ── build_map ─────────────────────────────────────────────────────────────
def test_build_map_grid_shape_and_extent() -> None:
    z = _plane(_X, _Y)
    m = build_map(_X, _Y, z, MapState(method="linear", nx=5, ny=4))
    assert m.z_grid.shape == (4, 5)
    assert m.x_axis.shape == (5,)
    assert m.y_axis.shape == (4,)
    assert m.x_axis[0] == pytest.approx(0.0)
    assert m.x_axis[-1] == pytest.approx(1.0)
    assert m.y_axis[0] == pytest.approx(0.0)
    assert m.y_axis[-1] == pytest.approx(1.0)


def test_build_map_linear_reproduces_plane() -> None:
    # Inside the unit-square hull, linear interpolation is exact for a plane.
    z = _plane(_X, _Y)
    m = build_map(_X, _Y, z, MapState(method="linear", nx=5, ny=4))
    expected = _plane(*np.meshgrid(m.x_axis, m.y_axis))
    assert np.all(np.isfinite(m.z_grid))  # whole grid lies within the hull
    np.testing.assert_allclose(m.z_grid, expected, rtol=1e-9, atol=1e-9)


def test_build_map_carries_labels() -> None:
    z = _plane(_X, _Y)
    m = build_map(
        _X, _Y, z, MapState(method="idw", nx=4, ny=4),
        x_label="Qx", x_unit="1/A", y_label="Qz", y_unit="1/A",
        z_label="Intensity", z_unit="cps",
    )
    assert (m.x_label, m.x_unit) == ("Qx", "1/A")
    assert (m.z_label, m.z_unit) == ("Intensity", "cps")


def test_build_map_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        build_map([0.0, 1.0], [0.0, 1.0], [0.0, 1.0])


# ── map_from_datastruct ───────────────────────────────────────────────────
def _three_col_ds() -> DataStruct:
    z = _plane(_X, _Y)
    return DataStruct.create(
        time=np.arange(_X.size, dtype=float),
        values=np.column_stack([_X, _Y, z]),
        labels=["Qx", "Qz", "Intensity"],
        units=["1/A", "1/A", "cps"],
        metadata={"source": "/tmp/rsm.dat"},
    )


def test_map_from_datastruct_by_index() -> None:
    ds = _three_col_ds()
    m = map_from_datastruct(ds, 0, 1, 2, MapState(method="linear", nx=5, ny=4))
    expected = _plane(*np.meshgrid(m.x_axis, m.y_axis))
    np.testing.assert_allclose(m.z_grid, expected, rtol=1e-9, atol=1e-9)
    assert m.x_label == "Qx"
    assert m.z_unit == "cps"
    assert m.metadata["source"] == "/tmp/rsm.dat"


def test_map_from_datastruct_by_label() -> None:
    ds = _three_col_ds()
    m = map_from_datastruct(ds, "Qx", "Qz", "Intensity", MapState(method="idw", nx=4, ny=4))
    assert (m.y_label, m.y_unit) == ("Qz", "1/A")
    assert m.z_label == "Intensity"


# ── auto method selection (RSM_CUTS_PLAN item 16) ──────────────────────────
# The "auto" default's job is picking the right ALGORITHM for the cloud size /
# topology; the algorithms themselves (linear/natural numeric parity) are
# covered by test_calc_interp2d.py, so these assert the CHOICE, not numbers.


def test_mapstate_default_method_is_auto() -> None:
    assert MapState().method == "auto"


def test_auto_passes_through_an_explicit_method_unchanged() -> None:
    x = np.array([0.0, 1.0, 0.0])
    y = np.array([0.0, 0.0, 1.0])
    z = np.array([1.0, 2.0, 3.0])
    for explicit in ("natural", "linear", "nearest", "idw", "thinplate", "cubic"):
        assert _resolve_auto_method(explicit, x, y, z) == explicit


def test_auto_picks_natural_for_a_small_scattered_cloud() -> None:
    rng = np.random.default_rng(0)
    n = 50  # well under _AUTO_LINEAR_MIN_POINTS, and not on a grid
    x, y, z = rng.uniform(0, 1, n), rng.uniform(0, 1, n), rng.uniform(0, 1, n)
    assert _resolve_auto_method("auto", x, y, z) == "natural"


def test_auto_picks_linear_for_a_large_scattered_cloud() -> None:
    # Large-but-ungridded is exactly the Q-space case (item 16): a curvilinear
    # (Qx, Qz) cloud that detect_regular_grid does NOT find gridded, so only
    # the size clause routes it to the fast method.
    rng = np.random.default_rng(0)
    n = _AUTO_LINEAR_MIN_POINTS + 500
    x, y, z = rng.uniform(0, 1, n), rng.uniform(0, 1, n), rng.uniform(0, 1, n)
    assert _resolve_auto_method("auto", x, y, z) == "linear"


def test_auto_picks_linear_for_a_small_regular_grid() -> None:
    # A 10x10 regular grid is far under the size threshold but IS gridded --
    # detect_regular_grid finds it, so "auto" takes the fast grid-lookup path
    # (interp2d._query_grid_linear) even though the cloud itself is small.
    xa, ya = np.meshgrid(np.linspace(0, 1, 10), np.linspace(0, 1, 10))
    x, y = xa.ravel(), ya.ravel()
    z = _plane(x, y)
    assert _resolve_auto_method("auto", x, y, z) == "linear"


def test_auto_ignores_nonfinite_points_when_thresholding() -> None:
    # NaN dead-pixel rows shouldn't tip the size threshold (regrid2d/
    # interpolate2d drop them before interpolating; the resolver should judge
    # the cloud regrid2d will actually see, not the raw padded input).
    rng = np.random.default_rng(1)
    n = 50
    x, y, z = rng.uniform(0, 1, n), rng.uniform(0, 1, n), rng.uniform(0, 1, n)
    pad = np.full(_AUTO_LINEAR_MIN_POINTS, np.nan)
    x_pad = np.concatenate([x, pad])
    y_pad = np.concatenate([y, pad])
    z_pad = np.concatenate([z, pad])
    assert _resolve_auto_method("auto", x_pad, y_pad, z_pad) == "natural"


def test_build_map_auto_default_end_to_end() -> None:
    # The bare MapState() default (no method given) resolves and builds
    # without raising -- small scattered cloud, so the "natural" path.
    z = _plane(_X, _Y)
    m = build_map(_X, _Y, z, MapState(nx=4, ny=4))
    assert m.z_grid.shape == (4, 4)
    assert np.all(np.isfinite(m.z_grid))


@pytest.mark.realdata
def test_auto_qspace_map_builds_fast_on_real_corpus(corpus_dir: Path) -> None:
    """RSM_CUTS_PLAN item 16's acceptance bound: a real large Q-space
    (Qx, Qz) map -- the curvilinear cloud ``detect_regular_grid`` does NOT
    find gridded, so this is the case that only the size clause of "auto"
    catches -- must reach the fast path. The file this loop actually selects
    is m3learning_rsm.xrdml at 465,885 points (sorted() puts capitals first,
    so it is the first >=100k qualifier), NOT the ~100k-point file the
    original docstring described -- "linear" on this cloud measures 13-16s
    warm / ~27s cold on the dev machine (2026-08-11 recalibration, verified
    at the original calibration commit too: no product regression, the
    original budget was simply calibrated against a premise that never
    matched the selected file). The point is confirming "auto" actually
    reaches the fast path on real data -- the method assertion below does
    that deterministically; the clock is only a catastrophic-regression
    backstop. Skips when the corpus or a big-enough Q-space RSM is absent
    (local-only, like the rest of realdata)."""
    from quantized.io.registry import import_auto

    files = sorted((corpus_dir / "panalytical" / "xrd").glob("*.xrdml"))
    if not files:
        pytest.skip("no PANalytical corpus files present")
    for f in files:
        ds = import_auto(str(f))
        if (
            ds.metadata.get("is2D")
            and "Qx" in ds.labels
            and "Qz" in ds.labels
            and ds.values.shape[0] >= 100_000
        ):
            break
    else:
        pytest.skip("no >=100k-point Q-space RSM in corpus")

    xi, yi, zi = ds.labels.index("Qx"), ds.labels.index("Qz"), ds.labels.index("Intensity")
    t0 = time.perf_counter()
    m = map_from_datastruct(ds, xi, yi, zi, MapState(nx=200, ny=200))  # method="auto" default
    elapsed = time.perf_counter() - t0

    n = ds.values.shape[0]
    # The load-INVARIANT half of the assertion, and the one that actually
    # encodes the fix: "auto" must resolve to the fast path on this cloud. A
    # regression that reinstates Sibson fails here deterministically, on any
    # machine, at any load.
    assert (
        _resolve_auto_method(
            "auto", ds.column("Qx"), ds.column("Qz"), ds.column("Intensity")
        )
        == "linear"
    )
    # The wall-clock half is a coarse backstop only. Recalibrated 2026-08-11
    # against the file this loop ACTUALLY selects (465,885 pts): "linear"
    # measures 13-16s warm on the dev machine (max observed 16.1s across five
    # runs, incl. standalone; ~27s cold in a fresh venv), and the same input
    # at the original calibration commit took 26.7s -- so the old 2s/8s
    # budgets were never achievable here and failed deterministically, not as
    # load flakes. 90s = TEST_DETERMINISM's max(old, 5x measured) rule with
    # cold-start slack; a regression to Sibson "natural" on a 466k cloud is
    # minutes-class and still trips it. The method assertion above is the
    # real guard -- never tighten this into a performance benchmark.
    assert elapsed < 90.0, f"auto-selected method took {elapsed:.2f}s (want < 90s) on {n} pts"
    assert m.z_grid.shape == (200, 200)
