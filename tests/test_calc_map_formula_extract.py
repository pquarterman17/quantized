"""Item 32: map values from a formula, and pixel extraction across maps
(calc + the three /api/map-ops routes)."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc import map_extract, map_formula
from quantized.calc.map_ops import MapGrid
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

XA = np.array([0.0, 1.0, 2.0, 3.0])
YA = np.array([10.0, 20.0, 30.0])


def _grid(z: np.ndarray, x: np.ndarray = XA, y: np.ndarray = YA) -> MapGrid:
    return MapGrid(x=x, y=y, z=z, x_label="H", x_unit="T", y_label="T", y_unit="K",
                   z_unit="V", metadata={})


def _ds(z: np.ndarray) -> DataStruct:
    return grid_map_datastruct(
        z, XA, YA, x_label="H", x_unit="T", y_label="T", y_unit="K", z_unit="V"
    )


Z0 = np.arange(12, dtype=float).reshape(3, 4)


def test_formula_matches_a_hand_computed_grid() -> None:
    out, info = map_formula.map_formula(_grid(Z0), "2*z + x - y/10 + sqrt(4)")
    xx, yy = np.meshgrid(XA, YA)
    assert np.allclose(out.z, 2 * Z0 + xx - yy / 10 + 2)
    assert info["op"] == "formula" and info["expr"].startswith("2*z")
    # the input map is untouched, axes unchanged, unit blank unless given
    assert np.array_equal(_grid(Z0).z, Z0)
    assert np.array_equal(out.x, XA) and out.z_unit == ""
    assert map_formula.map_formula(_grid(Z0), "z", unit="A")[0].z_unit == "A"


def test_formula_keeps_blank_cells_and_np_prefix_and_caret() -> None:
    z = Z0.copy()
    z[1, 2] = np.nan
    out, _ = map_formula.map_formula(_grid(z), "np.abs(z - 5)^2")
    want = np.abs(z - 5) ** 2
    assert np.allclose(out.z, want, equal_nan=True) and np.isnan(out.z[1, 2])


@pytest.mark.parametrize(
    "expr",
    [
        "",
        "A + 1",  # a column letter is not a map variable
        "w * 2",
        "z > 1",
        "z > 1 ? 1 : 0",
        "z[0]",
        "__import__('os').system('x')",
        "open('f')",
        "col('Name')",
        "mean(z)",
        "cumsum(z)",
        "lag(z)",
        "z2",
        "z +",
        "(" * 5000,
    ],
)
def test_formula_refuses_unsafe_or_unsupported_input(expr: str) -> None:
    with pytest.raises(ValueError):
        map_formula.map_formula(_grid(Z0), expr)


def test_formula_with_no_finite_result_is_refused() -> None:
    with pytest.raises(ValueError, match="no finite value"):
        map_formula.map_formula(_grid(Z0), "nan * z")


def _series(n: int = 6) -> list[tuple[str, MapGrid]]:
    """Identical plane maps (bilinear interpolation is exact on a plane)."""
    xs = np.linspace(0.0, 3.0, 31)
    ys = np.linspace(10.0, 30.0, 21)
    xx, yy = np.meshgrid(xs, ys)
    out = []
    for k in range(n):
        z = 5.0 + 2.0 * xx + 0.1 * yy  # bilinear interpolation is exact on a plane
        out.append((f"scan{k}", _grid(z, xs, ys)))
    return out


def test_pixel_extraction_is_bilinear_and_exact_on_a_plane() -> None:
    res = map_extract.extract_pixel(_series(), 1.234, 17.77)
    want = 5.0 + 2.0 * 1.234 + 0.1 * 17.77
    assert res.n_points == 6
    assert np.allclose(res.values[:, 0 + 1], want)  # column 0 is the map code
    assert res.labels[1] == "Value" and res.units[1] == "V"
    assert res.metadata["extract"]["interpolation"] == "bilinear"
    assert list(res.time) == [1, 2, 3, 4, 5, 6]


def test_pixel_extraction_tracks_a_known_drift_across_a_series() -> None:
    xs = np.linspace(0.0, 3.0, 31)
    ys = np.linspace(10.0, 30.0, 21)
    xx, yy = np.meshgrid(xs, ys)
    maps = []
    for k in range(6):
        z = 100.0 * np.exp(-((xx - (1.0 + 0.2 * k)) ** 2) / 0.1) - 0.0 * yy
        maps.append((f"T{k}", _grid(z, xs, ys)))
    res = map_extract.extract_pixel(maps, 1.0, 20.0)
    value = res.values[:, 1]
    assert np.all(np.diff(value) < 0)  # the peak walks away from x = 1
    assert np.allclose(value, 100.0 * np.exp(-((1.0 - (1.0 + 0.2 * np.arange(6))) ** 2) / 0.1))
    # on a cell centre the bilinear value is exactly that cell
    assert np.allclose(res.values[:, 1], res.values[:, 2])


def test_pixel_extraction_does_not_extrapolate_or_guess_across_blank_cells() -> None:
    g = _grid(Z0.copy())
    bad = Z0.copy()
    bad[1, 1] = np.nan
    res = map_extract.extract_pixel([("ok", g), ("holey", _grid(bad)), ("out", g)], 0.5, 15.0)
    assert np.isfinite(res.values[0, 1])
    assert np.isnan(res.values[1, 1]) and np.isfinite(res.values[1, 2])  # nearest still reported
    notes = {n["map"]: n["note"] for n in res.metadata["extract"]["notes"]}
    assert notes == {"holey": "a surrounding cell is blank"}
    far = map_extract.extract_pixel([("ok", g), ("also", g)], 3.0, 30.0)  # the corner itself
    assert np.allclose(far.values[:, 1], Z0[2, 3])
    with pytest.raises(ValueError, match="no value in any map"):
        map_extract.extract_pixel([("ok", g)], 99.0, 15.0)
    with pytest.raises(ValueError):
        map_extract.extract_pixel([], 0.0, 0.0)
    with pytest.raises(ValueError):
        map_extract.extract_pixel([("ok", g)], float("nan"), 0.0)


def test_duplicate_map_names_stay_distinct() -> None:
    g = _grid(Z0)
    res = map_extract.extract_pixel([("m", g), ("m", g)], 1.0, 20.0)
    assert res.metadata["extract"]["maps"] == ["m", "m (2)"]


def test_routes_grid_formula_extract_and_refusals() -> None:
    client = TestClient(create_app())
    rng = np.random.default_rng(3)
    x, y = rng.uniform(1, 5, 80), rng.uniform(1, 3, 80)
    sheet = DataStruct.create(
        x, np.column_stack([y, 2 + 0.5 * x - 0.3 * y]), labels=["T", "R"], units=["K", "ohm"],
        metadata={"x_column_name": "H", "x_column_unit": "T"},
    ).to_dict()
    r = client.post("/api/map-ops/grid", json={
        "dataset": sheet, "x_col": -1, "y_col": 0, "z_col": 1, "method": "kriging",
        "nx": 12, "ny": 10, "output": "variance"})
    assert r.status_code == 200, r.text
    var = DataStruct.from_dict(r.json())
    assert var.metadata["map_shape"] == [10, 12] and var.units == ("T", "K", "(ohm)^2")
    assert var.metadata["map_op"]["method"] == "kriging"
    bad = client.post("/api/map-ops/grid", json={
        "dataset": sheet, "x_col": -1, "y_col": 0, "z_col": 1, "method": "linear",
        "log_x": True, "nx": 6, "ny": 6, "output": "variance"})
    assert bad.status_code == 422
    ok = client.post("/api/map-ops/grid", json={
        "dataset": sheet, "x_col": "H", "y_col": "T", "z_col": "R", "method": "shepard",
        "nx": 6, "ny": 6, "log_x": True, "log_y": True})
    assert ok.status_code == 200, ok.text
    assert client.post("/api/map-ops/grid", json={
        "dataset": sheet, "x_col": -1, "y_col": -1, "z_col": 1}).status_code == 422
    m = _ds(Z0).to_dict()
    f = client.post("/api/map-ops/formula", json={"dataset": m, "expr": "z*10"})
    assert f.status_code == 200, f.text
    fo = DataStruct.from_dict(f.json())
    assert np.allclose(fo.values[:, 2], Z0.ravel() * 10)
    assert fo.metadata["map_op"] == {"op": "formula", "expr": "z*10", "n_finite": 12, "n_cells": 12}
    unsafe = client.post("/api/map-ops/formula", json={"dataset": m, "expr": "z > 1"})
    assert unsafe.status_code == 422
    e = client.post("/api/map-ops/extract", json={
        "maps": [{"name": "a", "dataset": m}, {"name": "b", "dataset": fo.to_dict()}],
        "x": 1.0, "y": 20.0})
    assert e.status_code == 200, e.text
    table = DataStruct.from_dict(e.json())
    assert np.allclose(table.values[:, 1], [Z0[1, 1], 10 * Z0[1, 1]])
    assert client.post("/api/map-ops/extract", json={"maps": [], "x": 0, "y": 0}).status_code == 422
