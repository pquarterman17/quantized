"""MapData + build_map + map_from_datastruct (calc/map.py).

The interpolation itself is golden-tested in ``test_calc_interp2d``; here we
test the 2-D map *contract* (shape validation, axis/grid wiring, nan-aware
colour range, DataStruct column extraction, serialization). The one numeric
assertion uses a linear field ``z = 2x + 3y + 1`` — barycentric ``linear``
interpolation reproduces a linear function exactly inside the convex hull, so
the expected grid is known without a golden freeze.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.map import MapData, MapState, build_map, map_from_datastruct
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
