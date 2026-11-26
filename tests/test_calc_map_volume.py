"""calc/map_volume: ROI volume of known analytic surfaces; fail-closed inputs."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc._map_points import MapPoints
from quantized.calc.map_volume import roi_volume, volume_table_datastruct

X = np.linspace(-5.0, 5.0, 201)  # dx = 0.05
Y = np.linspace(-4.0, 4.0, 161)  # dy = 0.05
DA = 0.05 * 0.05
GX, GY = np.meshgrid(X, Y)


def _pts(z: np.ndarray) -> MapPoints:
    return MapPoints(GX.ravel(), GY.ravel(), z.ravel(), "X", "mm", "Y", "mm", "Z", "V", X, Y, z)


def _gauss(amp: float = 10.0, s: float = 0.6) -> np.ndarray:
    return np.asarray(amp * np.exp(-0.5 * (GX**2 + GY**2) / s**2))


RECT = {"kind": "rect", "x0": -3.0, "x1": 3.0, "y0": -3.0, "y1": 3.0}
SQUARE_POLY = {"kind": "polygon", "points": [[-3, -3], [3, -3], [3, 3], [-3, 3]]}


def test_plane_over_a_rectangle() -> None:
    z = 2.0 * GX - 1.0 * GY + 7.0
    res = roi_volume(_pts(z), {"kind": "rect", "x0": -2.0, "x1": 2.0, "y0": -1.0, "y1": 3.0})
    # Analytic: mean height over a rectangle is the height at its centre (0, 1).
    area = 4.0 * 4.0
    assert res["n_cells"] == 81 * 81
    assert res["area"] == pytest.approx(81 * 81 * DA)
    assert res["raw_volume"] == pytest.approx(6.0 * 81 * 81 * DA, rel=1e-9)
    assert res["area"] == pytest.approx(area, rel=0.03)


def test_gaussian_volume_with_and_without_constant_background() -> None:
    z = _gauss() + 4.0
    exact = 2 * np.pi * 10.0 * 0.36
    raw = roi_volume(_pts(z), RECT)
    assert raw["volume"] == raw["raw_volume"] and raw["background"] == {"kind": "none"}
    const = roi_volume(_pts(z), RECT, {"kind": "constant", "value": 4.0})
    assert const["volume"] == pytest.approx(exact, rel=2e-3)
    auto = roi_volume(_pts(z), RECT, {"kind": "constant"})
    assert auto["background"]["source"] == "border mean"
    assert auto["volume"] == pytest.approx(exact, rel=5e-3)


def test_gaussian_on_a_tilted_plane_rectangle_and_polygon() -> None:
    z = _gauss() + 0.5 * GX - 0.3 * GY + 6.0
    exact = 2 * np.pi * 10.0 * 0.36
    for region in (RECT, SQUARE_POLY):
        res = roi_volume(_pts(z), region, {"kind": "plane"})
        assert res["background"]["a"] == pytest.approx(0.5, abs=5e-3)
        assert res["background"]["b"] == pytest.approx(-0.3, abs=5e-3)
        assert res["background"]["c"] == pytest.approx(6.0, abs=5e-2)
        assert res["volume"] == pytest.approx(exact, rel=1e-2)
    # Without the background the tilt biases the answer.
    assert abs(roi_volume(_pts(z), RECT)["volume"] - exact) > 5 * exact


def test_triangle_polygon_area() -> None:
    tri = {"kind": "polygon", "points": [[-3, -3], [3, -3], [0, 3]]}
    res = roi_volume(_pts(np.ones_like(GX)), tri)
    assert res["area"] == pytest.approx(18.0, rel=0.02)
    assert res["mean"] == pytest.approx(1.0)


def test_empty_region_and_bad_regions_are_refused() -> None:
    z = _gauss()
    with pytest.raises(ValueError, match="no cells"):
        roi_volume(_pts(z), {"kind": "rect", "x0": 20, "x1": 30, "y0": 0, "y1": 1})
    with pytest.raises(ValueError, match="at least 3"):
        roi_volume(_pts(z), {"kind": "polygon", "points": [[0, 0], [1, 1]]})
    with pytest.raises(ValueError, match="kind"):
        roi_volume(_pts(z), {"kind": "circle"})
    with pytest.raises(ValueError, match="numeric"):
        roi_volume(_pts(z), {"kind": "rect", "x0": "a"})
    with pytest.raises(ValueError, match="finite"):
        roi_volume(_pts(z), {"kind": "rect", "x0": np.nan, "x1": 1, "y0": 0, "y1": 1})


def test_nan_cells_refuse_unless_skipped() -> None:
    z = _gauss().copy()
    z[80:84, 100:104] = np.nan
    with pytest.raises(ValueError, match="16 of .* have no value"):
        roi_volume(_pts(z), RECT)
    res = roi_volume(_pts(z), RECT, on_nan="skip")
    assert res["n_nan"] == 16
    full = roi_volume(_pts(_gauss()), RECT)
    assert res["n_cells"] == full["n_cells"] - 16
    # An all-empty region is still refused.
    z[:] = np.nan
    with pytest.raises(ValueError, match="no value|empty"):
        roi_volume(_pts(z), RECT, on_nan="skip")


def test_plane_background_needs_a_fittable_ring() -> None:
    one_col = {"kind": "rect", "x0": 0.0, "x1": 0.0, "y0": -1.0, "y1": 1.0}
    with pytest.raises(ValueError, match="collinear"):
        roi_volume(_pts(_gauss()), one_col, {"kind": "plane"})
    with pytest.raises(ValueError, match="background.kind"):
        roi_volume(_pts(_gauss()), RECT, {"kind": "cubic"})


def test_scattered_cloud_is_refused() -> None:
    rng = np.random.default_rng(1)
    x, y = rng.uniform(0, 1, 50), rng.uniform(0, 1, 50)
    with pytest.raises(ValueError, match="regular grid"):
        roi_volume(MapPoints(x, y, x + y, "X", "", "Y", "", "Z", ""), RECT)


def test_table_carries_settings() -> None:
    res = roi_volume(_pts(_gauss()), RECT, {"kind": "constant", "value": 0.0})
    t = volume_table_datastruct(res, "m")
    assert t.labels[0] == "Volume" and t.units[0] == "V mm mm"
    assert t.metadata["map_volume"]["region"] == RECT
    assert t.metadata["map_volume"]["background"]["value"] == 0.0


def test_trapezoid_rule_is_the_trapezoid_integral_over_the_nodes() -> None:
    z = _gauss() + 3.0
    whole = {"kind": "rect", "x0": -5, "x1": 5, "y0": -4, "y1": 4}
    got = roi_volume(_pts(z), whole, rule="trapezoid")
    expect = np.trapezoid(np.trapezoid(z, X, axis=1), Y)
    assert got["raw_volume"] == pytest.approx(float(expect), rel=1e-12)
    assert got["rule"] == "trapezoid" and got["n_cells"] == 200 * 160
    assert got["area"] == pytest.approx(10.0 * 8.0)


def test_trapezoid_background_and_default_rule() -> None:
    z = np.full_like(GX, 5.0)
    region = {"kind": "rect", "x0": -2, "x1": 2, "y0": -2, "y1": 2}
    tr = roi_volume(_pts(z), region, {"kind": "constant", "value": 5.0}, rule="trapezoid")
    assert tr["volume"] == pytest.approx(0.0, abs=1e-9)
    assert tr["raw_volume"] == pytest.approx(5.0 * 16.0)  # 4 x 4 extent, not 4.05 x 4.05
    px = roi_volume(_pts(z), region)
    assert px["rule"] == "pixel" and px["raw_volume"] == pytest.approx(5.0 * 81 * 81 * DA)


def test_trapezoid_polygon_and_a_region_with_no_full_cell() -> None:
    z = 2.0 * GX + 1.0
    corners = [[-3.01, -3.01], [3.01, -3.01], [3.01, 3.01], [-3.01, 3.01]]
    poly = {"kind": "polygon", "points": corners}
    tri = roi_volume(_pts(z), poly, rule="trapezoid")
    assert tri["area"] == pytest.approx(36.0)  # nodes -3..3: 6 x 6 extent
    assert tri["raw_volume"] == pytest.approx(36.0)  # odd term integrates to 0
    with pytest.raises(ValueError, match="trapezoid rule needs"):
        sliver = {"kind": "rect", "x0": 0, "x1": 0.01, "y0": -1, "y1": 1}
        roi_volume(_pts(z), sliver, rule="trapezoid")
    with pytest.raises(ValueError, match="rule must be"):
        roi_volume(_pts(z), RECT, rule="simpson")
