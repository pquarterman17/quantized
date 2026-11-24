"""Map operations (calc/map_ops, calc/map_arith, /api/map-ops): coordinate
correctness per op, arithmetic grid checks, plane levelling recovering a tilt."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc import map_arith, map_ops
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

NX, NY = 6, 4
X = np.linspace(10.0, 15.0, NX)
Y = np.linspace(-1.0, 2.0, NY)
Z = np.arange(NY * NX, dtype=float).reshape(NY, NX)  # z[j, i] at (X[i], Y[j])


def _ds(z: np.ndarray = Z, x: np.ndarray = X, y: np.ndarray = Y, **kw: str) -> DataStruct:
    return grid_map_datastruct(
        z,
        x,
        y,
        x_label=kw.get("xl", "Qx"),
        x_unit=kw.get("xu", "1/A"),
        y_label=kw.get("yl", "Qz"),
        y_unit=kw.get("yu", "1/nm"),
        z_unit=kw.get("zu", "cts"),
    )


def _grid(ds: DataStruct) -> map_ops.MapGrid:
    return map_ops.read_grid(ds)


def test_read_grid_roundtrip() -> None:
    g = _grid(_ds())
    np.testing.assert_allclose(g.x, X)
    np.testing.assert_allclose(g.y, Y)
    np.testing.assert_array_equal(g.z, Z)
    names = (g.x_label, g.x_unit, g.y_label, g.y_unit, g.z_unit)
    assert names == ("Qx", "1/A", "Qz", "1/nm", "cts")


def test_crop_coordinates() -> None:
    out, _ = map_ops.crop(_grid(_ds()), xmin=11.0, xmax=13.0, ymin=0.0, ymax=None)
    np.testing.assert_allclose(out.x, X[1:4])
    np.testing.assert_allclose(out.y, Y[1:])
    np.testing.assert_array_equal(out.z, Z[1:, 1:4])


def test_crop_refusals() -> None:
    g = _grid(_ds())
    with pytest.raises(ValueError, match="at least 2"):
        map_ops.crop(g, xmin=100.0, xmax=200.0)
    with pytest.raises(ValueError, match="greater than"):
        map_ops.crop(g, xmin=14.0, xmax=11.0)


def test_flip_keeps_axes() -> None:
    g = _grid(_ds())
    h, _ = map_ops.flip(g, "h")
    v, _ = map_ops.flip(g, "v")
    np.testing.assert_array_equal(h.z, Z[:, ::-1])
    np.testing.assert_array_equal(v.z, Z[::-1, :])
    np.testing.assert_allclose(h.x, X)
    np.testing.assert_allclose(v.y, Y)
    with pytest.raises(ValueError):
        map_ops.flip(g, "d")


def test_transpose_swaps_axes_and_labels() -> None:
    t, _ = map_ops.transpose(_grid(_ds()))
    np.testing.assert_array_equal(t.z, Z.T)
    np.testing.assert_allclose(t.x, Y)
    np.testing.assert_allclose(t.y, X)
    assert (t.x_label, t.x_unit, t.y_label, t.y_unit) == ("Qz", "1/nm", "Qx", "1/A")


def _marker_rotation(deg: int) -> tuple[int, int]:
    """Where a lone marker at the bottom-right cell (x max, y min) lands."""
    z = np.zeros((NY, NX))
    z[0, NX - 1] = 1.0
    out, _ = map_ops.rotate(_grid(_ds(z)), deg)
    j, i = np.argwhere(out.z == 1.0)[0]
    return int(j), int(i)


def test_rotate_marker_positions_counter_clockwise() -> None:
    # bottom-right -> top-right (90) -> top-left (180) -> bottom-left (270)
    assert _marker_rotation(90) == (NX - 1, NY - 1)  # new grid is (nx, ny): top-right
    assert _marker_rotation(180) == (NY - 1, 0)
    assert _marker_rotation(270) == (0, 0)


@pytest.mark.parametrize("deg", [90, 270])
def test_rotate_quarter_swaps_axes(deg: int) -> None:
    out, _ = map_ops.rotate(_grid(_ds()), deg)
    assert out.z.shape == (NX, NY)
    np.testing.assert_allclose(out.x, Y)
    np.testing.assert_allclose(out.y, X)
    assert (out.x_label, out.x_unit, out.y_label, out.y_unit) == ("Qz", "1/nm", "Qx", "1/A")


def test_rotate_composition_identities() -> None:
    g = _grid(_ds())
    r90, _ = map_ops.rotate(g, 90)
    r180, _ = map_ops.rotate(r90, 90)
    direct, _ = map_ops.rotate(g, 180)
    np.testing.assert_array_equal(r180.z, direct.z)
    back, _ = map_ops.rotate(r90, 270)
    np.testing.assert_array_equal(back.z, Z)
    np.testing.assert_allclose(back.x, X)
    with pytest.raises(ValueError):
        map_ops.rotate(g, 45)


@pytest.mark.parametrize("deg", [90, 180, 270])
def test_rotate_matches_numpy_rot90_in_y_up_display(deg: int) -> None:
    """Oracle: np.rot90 turns a top-row-first image CCW; a Y-up map is that image flipped."""
    expected = np.rot90(Z[::-1], deg // 90)[::-1]
    out, _ = map_ops.rotate(_grid(_ds()), deg)
    np.testing.assert_array_equal(out.z, expected)


def test_result_is_native_grid_with_provenance() -> None:
    out, info = map_ops.rotate(_grid(_ds()), 90)
    ds = map_ops.grid_result(out, info)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_grid"] == "native"
    assert ds.metadata["map_shape"] == [NX, NY]
    assert ds.metadata["map_op"] == {"op": "rotate", "degrees": 90}
    assert ds.labels[:2] == ("Qz", "Qx")


def test_plane_level_recovers_known_tilt() -> None:
    xx, yy = np.meshgrid(X, Y)
    z = 5.0 + 0.7 * xx - 1.3 * yy
    out, info = map_ops.plane_level(_grid(_ds(z)), 1)
    np.testing.assert_allclose(out.z, 0.0, atol=1e-10)
    assert info["tilt"]["dQx"] == pytest.approx(0.7, abs=1e-10)
    assert info["tilt"]["dQz"] == pytest.approx(-1.3, abs=1e-10)


def test_plane_level_keeps_feature_and_restore_mean() -> None:
    xx, yy = np.meshgrid(np.linspace(0, 9, 10), np.linspace(0, 7, 8))
    bump = np.exp(-((xx - 4.5) ** 2 + (yy - 3.5) ** 2) / 2.0)
    z = bump + 0.2 * xx + 0.1 * yy + 3.0
    g = _grid(_ds(z, np.linspace(0, 9, 10), np.linspace(0, 7, 8)))
    out, _ = map_ops.plane_level(g, 1)
    assert np.abs(out.z - bump).max() < 0.1  # bump survives (small LSQ leakage)
    kept, _ = map_ops.plane_level(g, 1, restore_mean=True)
    assert kept.z.mean() == pytest.approx(z.mean(), abs=1e-9)


def test_plane_level_order2_and_nan_cells() -> None:
    xx, yy = np.meshgrid(np.linspace(-3, 3, 9), np.linspace(-2, 2, 7))
    z = 1.0 + 0.5 * xx + 0.2 * yy + 0.3 * xx**2 - 0.4 * xx * yy + 0.1 * yy**2
    z[2, 3] = np.nan
    out, _ = map_ops.plane_level(_grid(_ds(z, np.linspace(-3, 3, 9), np.linspace(-2, 2, 7))), 2)
    np.testing.assert_allclose(out.z[np.isfinite(out.z)], 0.0, atol=1e-9)
    assert np.isnan(out.z[2, 3])
    with pytest.raises(ValueError, match="order"):
        map_ops.plane_level(_grid(_ds()), 3)


def test_non_grid_refused() -> None:
    rng = np.random.default_rng(0)
    pts = rng.random((40, 3))
    ds = DataStruct.create(pts[:, 0], pts, labels=["a", "b", "Intensity"], units=["", "", ""])
    with pytest.raises(ValueError, match="regular grid"):
        map_ops.read_grid(ds)


def test_ambiguous_columns_refused() -> None:
    v = np.zeros((9, 4))
    ds = DataStruct.create(v[:, 0], v, labels=["a", "b", "c", "d"], units=["", "", "", ""])
    with pytest.raises(ValueError, match="explicitly"):
        map_ops.read_grid(ds)


# ── arithmetic ──────────────────────────────────────────────────────────────
def test_binary_same_grid() -> None:
    a, b = _grid(_ds()), _grid(_ds(Z * 2 + 1))
    out, info = map_arith.map_binary(a, b, "sub")
    np.testing.assert_allclose(out.z, Z - (Z * 2 + 1))
    assert info["interpolated"] is False
    out, _ = map_arith.map_binary(a, b, "mul")
    assert out.z_unit == "cts*cts"
    out, _ = map_arith.map_binary(a, b, "div")
    assert out.z_unit == "cts/cts"
    assert out.z[0, 0] == pytest.approx(0.0)


def test_divide_by_zero_is_nan_and_counted() -> None:
    b = np.ones((NY, NX))
    b[1, 1] = 0.0
    out, info = map_arith.map_binary(_grid(_ds()), _grid(_ds(b)), "div")
    assert np.isnan(out.z[1, 1])
    assert info["division_by_zero_cells"] == 1
    assert np.isfinite(out.z).sum() == NX * NY - 1


def test_different_grid_refused_then_interpolated() -> None:
    xb = np.linspace(10.0, 15.0, 11)
    yb = np.linspace(-1.0, 2.0, 7)
    xx, yy = np.meshgrid(xb, yb)
    plane = 2.0 * xx + 3.0 * yy
    a, b = _grid(_ds()), _grid(_ds(plane, xb, yb))
    with pytest.raises(ValueError, match="different grids"):
        map_arith.map_binary(a, b, "add")
    out, info = map_arith.map_binary(a, b, "add", interpolate=True)
    ax, ay = np.meshgrid(X, Y)
    # linear interpolation is exact on a plane
    np.testing.assert_allclose(out.z, Z + 2.0 * ax + 3.0 * ay, atol=1e-9)
    assert info["interpolated"] is True and info["cells_outside_b"] == 0


def test_interpolation_outside_extent_is_nan() -> None:
    b = _grid(_ds(np.ones((3, 3)), np.array([10.0, 11.0, 12.0]), np.array([-1.0, 0.0, 1.0])))
    out, info = map_arith.map_binary(_grid(_ds()), b, "add", interpolate=True)
    assert np.isnan(out.z[:, -1]).all()
    assert info["cells_outside_b"] > 0


def test_unit_and_axis_mismatch_refused() -> None:
    a = _grid(_ds())
    with pytest.raises(ValueError, match="cannot add"):
        map_arith.map_binary(a, _grid(_ds(zu="V")), "add")
    with pytest.raises(ValueError, match="axes differ"):
        map_arith.map_binary(a, _grid(_ds(xu="deg")), "sub")
    out, _ = map_arith.map_binary(a, _grid(_ds(zu="V")), "add", allow_mismatch=True)
    assert out.z_unit == "cts"


def test_scalar() -> None:
    a = _grid(_ds())
    out, _ = map_arith.map_scalar(a, "mul", 2.0)
    np.testing.assert_allclose(out.z, Z * 2)
    out, _ = map_arith.map_scalar(a, "sub", 1.0, reverse=True)
    np.testing.assert_allclose(out.z, 1.0 - Z)
    out, info = map_arith.map_scalar(a, "div", 4.0, reverse=True)
    assert np.isnan(out.z[0, 0]) and info["division_by_zero_cells"] == 1
    with pytest.raises(ValueError, match="zero"):
        map_arith.map_scalar(a, "div", 0.0)
    with pytest.raises(ValueError, match="finite"):
        map_arith.map_scalar(a, "add", float("nan"))


# ── a real importer's RSM (fixture) ─────────────────────────────────────────
_RSM = "tests/fixtures/xrdml_rsm_synthetic.xrdml"


def test_xrdml_rsm_angular_axes_work_and_q_space_is_refused() -> None:
    from quantized.io.xrdml import import_xrdml

    ds = import_xrdml(_RSM)
    # Default columns of a 5-column RSM resolve to the angular pair (2Theta, Omega).
    g = map_ops.read_grid(ds)
    assert (g.x_label, g.y_label, g.z_unit) == ("2Theta", "Omega", "cps")
    assert g.z.size == ds.values.shape[0] and np.isfinite(g.z).all()
    rot, info = map_ops.rotate(g, 90)
    out = map_ops.grid_result(rot, info)
    assert out.labels[:2] == ("Omega", "2Theta") and out.units[:2] == ("deg", "deg")
    # Q space is curvilinear: not a grid, so refused rather than silently resampled.
    with pytest.raises(ValueError, match="regular grid"):
        map_ops.read_grid(ds, "Qx", "Qz", "Intensity")


# ── route ───────────────────────────────────────────────────────────────────
client = TestClient(create_app())


def test_route_rotate_and_errors() -> None:
    post = client.post
    r = post("/api/map-ops/apply", json={"dataset": _ds().to_dict(), "op": "rotate", "degrees": 90})
    assert r.status_code == 200
    out = DataStruct.from_dict(r.json())
    assert out.labels[:2] == ("Qz", "Qx")
    assert out.metadata["map_op"]["op"] == "rotate"
    body = {"dataset": _ds().to_dict(), "op": "rotate"}
    bad = post("/api/map-ops/apply", json={**body, "degrees": 45})
    assert bad.status_code == 422
    miss = post("/api/map-ops/apply", json={"dataset": _ds().to_dict(), "op": "arith"})
    assert miss.status_code == 422 and "second map" in miss.json()["detail"]


def test_route_arith_grid_check() -> None:
    other = _ds(np.ones((3, 3)), np.array([10.0, 11.0, 12.0]), np.array([-1.0, 0.0, 1.0]))
    body = {"dataset": _ds().to_dict(), "op": "arith", "arith": "sub", "other": other.to_dict()}
    r = client.post("/api/map-ops/apply", json=body)
    assert r.status_code == 422 and "different grids" in r.json()["detail"]
    ok = client.post("/api/map-ops/apply", json={**body, "interpolate": True})
    assert ok.status_code == 200
