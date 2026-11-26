"""calc/map_peaks: peak finding + 2-D fitting on any map (planted-peak recovery)."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc._map_points import MapPoints, read_points
from quantized.calc.map_peaks import (
    find_map_peaks,
    map_peaks_from_datastruct,
    peak_table_datastruct,
)
from quantized.calc.rsm_analyze import rsm_analyze
from quantized.io._array_books import grid_map_datastruct

X = np.linspace(0.0, 10.0, 101)
Y = np.linspace(0.0, 8.0, 81)


def _g(
    x0: float, y0: float, amp: float, sx: float, sy: float, deg: float = 0.0, kind: str = "g"
) -> np.ndarray:
    gx, gy = np.meshgrid(X, Y)
    th = np.deg2rad(deg)
    u = ((gx - x0) * np.cos(th) + (gy - y0) * np.sin(th)) / sx
    v = (-(gx - x0) * np.sin(th) + (gy - y0) * np.cos(th)) / sy
    if kind == "g":
        return np.asarray(amp * np.exp(-0.5 * (u * u + v * v)))
    return np.asarray(amp / ((1 + u * u) * (1 + v * v)))


def _pts(z: np.ndarray) -> MapPoints:
    gx, gy = np.meshgrid(X, Y)
    return MapPoints(gx.ravel(), gy.ravel(), z.ravel(), "X", "mm", "Y", "mm", "Z", "cts", X, Y, z)


def _noisy_two_peaks() -> np.ndarray:
    z = _g(3, 3, 100, 0.5, 0.5) + _g(7, 5, 60, 0.9, 0.3, 30.0) + 5.0
    return z + np.random.default_rng(0).normal(0.0, 0.5, z.shape)


def test_two_planted_gaussians_one_rotated() -> None:
    res = find_map_peaks(_pts(_noisy_two_peaks()), n_peaks=2, rotate=True)
    a, b = res["peaks"]
    assert (a["x0"], a["y0"]) == pytest.approx((3.0, 3.0), abs=0.02)
    assert a["amplitude"] == pytest.approx(100.0, rel=0.03)
    assert a["fwhm_x"] == pytest.approx(2.3548 * 0.5, rel=0.03)
    assert a["volume"] == pytest.approx(2 * np.pi * 100 * 0.25, rel=0.03)
    assert (b["x0"], b["y0"]) == pytest.approx((7.0, 5.0), abs=0.02)
    assert b["fwhm_x"] == pytest.approx(2.3548 * 0.9, rel=0.03)
    assert b["fwhm_y"] == pytest.approx(2.3548 * 0.3, rel=0.03)
    assert b["angle_deg"] == pytest.approx(30.0, abs=1.0)
    assert b["volume"] == pytest.approx(2 * np.pi * 60 * 0.27, rel=0.03)
    assert b["background"] == pytest.approx(5.0, abs=0.3)
    # Standard errors are there and sensible.
    assert 0 < b["x0_err"] < 0.05
    assert 0 < b["angle_deg_err"] < 2.0
    assert 0 < b["volume_err"] < 0.1 * b["volume"]


def test_unrotated_fit_reports_zero_angle() -> None:
    res = find_map_peaks(_pts(_g(5, 4, 80, 0.8, 0.4) + 2.0), n_peaks=1)
    p = res["peaks"][0]
    assert p["angle_deg"] == 0.0 and p["angle_deg_err"] == 0.0
    assert p["fwhm_x"] == pytest.approx(2.3548 * 0.8, rel=0.01)
    assert p["fwhm_y"] == pytest.approx(2.3548 * 0.4, rel=0.01)


def test_lorentzian_recovery_and_volume() -> None:
    z = _g(4, 4, 50, 0.6, 0.4, 20.0, kind="l") + 1.0
    p = find_map_peaks(_pts(z), n_peaks=1, model="lorentzian", rotate=True, fit_window=12)["peaks"][
        0
    ]
    assert (p["x0"], p["y0"]) == pytest.approx((4.0, 4.0), abs=0.01)
    assert p["fwhm_x"] == pytest.approx(2 * 0.6, rel=0.02)
    assert p["fwhm_y"] == pytest.approx(2 * 0.4, rel=0.02)
    assert p["angle_deg"] == pytest.approx(20.0, abs=1.0)
    assert p["volume"] == pytest.approx(np.pi**2 * 50 * 0.6 * 0.4, rel=0.02)


def test_min_separation_merges_close_peaks() -> None:
    z = _g(4.0, 4.0, 100, 0.3, 0.3) + _g(4.8, 4.0, 90, 0.3, 0.3)
    near = find_map_peaks(_pts(z), smooth_sigma=0.0, min_separation=3, fit_window=5)
    far = find_map_peaks(_pts(z), smooth_sigma=0.0, min_separation=12, fit_window=5)
    assert near["n_found"] == 2
    assert far["n_found"] == 1


def test_threshold_and_peak_count() -> None:
    z = _g(2, 2, 100, 0.4, 0.4) + _g(6, 5, 40, 0.4, 0.4) + _g(8, 2, 8, 0.4, 0.4)
    all_peaks = find_map_peaks(_pts(z), threshold=0.02)
    assert all_peaks["n_found"] == 3
    assert [round(p["amplitude"]) for p in all_peaks["peaks"]] == [100, 40, 8]
    assert find_map_peaks(_pts(z), threshold=0.2)["n_found"] == 2
    assert len(find_map_peaks(_pts(z), threshold=0.02, n_peaks=2)["peaks"]) == 2


def test_nothing_found_or_bad_options_fail_closed() -> None:
    with pytest.raises(ValueError, match="flat"):
        find_map_peaks(_pts(np.full((81, 101), 3.0)))
    with pytest.raises(ValueError, match="threshold"):
        find_map_peaks(_pts(_g(5, 4, 1, 1, 1)), threshold=1.5)
    with pytest.raises(ValueError, match="model"):
        find_map_peaks(_pts(_g(5, 4, 1, 1, 1)), model="voigt")
    with pytest.raises(ValueError, match="fit_window"):
        find_map_peaks(_pts(_g(5, 4, 1, 1, 1)), fit_window=1)


def test_nan_cells_do_not_break_the_search() -> None:
    z = _g(5, 4, 80, 0.8, 0.5) + 1.0
    z[:5, :5] = np.nan
    p = find_map_peaks(_pts(z), n_peaks=1)["peaks"][0]
    assert p["ok"] and (p["x0"], p["y0"]) == pytest.approx((5.0, 4.0), abs=0.01)


def test_point_cloud_is_fitted_on_the_original_points() -> None:
    rng = np.random.default_rng(3)
    x, y = rng.uniform(0, 10, 6000), rng.uniform(0, 8, 6000)
    z = 70 * np.exp(-0.5 * (((x - 6) / 0.7) ** 2 + ((y - 3) / 0.5) ** 2)) + 2
    pts = MapPoints(x, y, z, "X", "mm", "Y", "mm", "Z", "cts")
    res = find_map_peaks(pts, n_peaks=1, fit_window=6)
    p = res["peaks"][0]
    assert not res["gridded"]
    assert (p["x0"], p["y0"]) == pytest.approx((6.0, 3.0), abs=0.03)
    assert p["fwhm_x"] == pytest.approx(2.3548 * 0.7, rel=0.05)


def test_any_map_datastruct_and_table() -> None:
    ds = grid_map_datastruct(
        _g(3, 3, 100, 0.5, 0.5) + _g(7, 5, 60, 0.6, 0.6),
        X,
        Y,
        x_label="Field",
        x_unit="T",
        y_label="Temp",
        y_unit="K",
        z_unit="V",
    )
    res = map_peaks_from_datastruct(ds, n_peaks=2)
    assert res["gridded"] and res["x_label"] == "Field"
    table = peak_table_datastruct(res, "m.dat")
    assert table.values.shape[0] == 2
    assert "Volume" in table.labels and "Volume err" in table.labels
    assert table.units[table.labels.index("Volume")] == "V T K"
    meta: Any = table.metadata["map_peaks"]
    assert meta["model"] == "gaussian" and len(meta["peaks"]) == 2
    with pytest.raises(ValueError, match="different"):
        read_points(ds, "Field", "Field", "Intensity")


def test_rsm_analyze_output_is_unchanged() -> None:
    """The RSM path was left untouched: pin its numbers on a fixed synthetic map."""
    ax1 = np.linspace(30.0, 31.0, 41)
    ax2 = np.linspace(60.0, 62.0, 61)
    tth, om = np.meshgrid(ax2, ax1)
    img = (
        1000 * np.exp(-((tth - 61.0) ** 2 / (2 * 0.3**2) + (om - 30.5) ** 2 / (2 * 0.1**2)))
        + 400 * np.exp(-((tth - 60.4) ** 2 / (2 * 0.3**2) + (om - 30.2) ** 2 / (2 * 0.1**2)))
        + 5.0
    )
    res = rsm_analyze(img, ax1, ax2, n_peaks=2, smooth_sigma=1.0, fit_window=8)
    assert res["n_peaks_found"] == 2
    sub, film = res["peaks"]
    assert (sub["classification"], film["classification"]) == ("substrate", "film")
    # Values measured on main before this lane (rsm_analyze.py is not modified).
    assert sub["centre_angle"] == pytest.approx([30.498111953814554, 60.99615718757728], rel=1e-6)
    assert film["centre_angle"] == pytest.approx([30.216082487327718, 60.43757756246805], rel=1e-6)
    assert sub["fwhm_angle"] == pytest.approx([0.23106342451558726, 0.6938923120978647], rel=1e-6)
    assert film["amplitude"] == pytest.approx(370.6147036473736, rel=1e-6)
    assert set(sub) == {
        "rank",
        "centre_angle",
        "centre_Q",
        "fwhm_angle",
        "fwhm_Q",
        "amplitude",
        "background",
        "classification",
    }
