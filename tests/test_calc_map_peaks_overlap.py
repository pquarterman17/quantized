"""calc/map_peaks on broad and neighbouring hills (duplicate peak, low volume)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc._map_points import MapPoints
from quantized.calc.map_peaks import find_map_peaks


def _map(n: int, peaks: list[tuple[float, float, float, float]], bg: float = 5.0) -> MapPoints:
    ax = np.linspace(0.0, 10.0, n)
    gx, gy = np.meshgrid(ax, ax)
    z = np.full_like(gx, bg)
    for x0, y0, amp, sig in peaks:
        z = z + amp * np.exp(-((gx - x0) ** 2 + (gy - y0) ** 2) / (2 * sig * sig))
    return MapPoints(gx.ravel(), gy.ravel(), z.ravel(), "X", "um", "Y", "um", "Z", "cts", ax, ax, z)


def _vol(amp: float, sig: float) -> float:
    return 2 * np.pi * amp * sig * sig


# The acceptance map: 24 x 24, planted Gaussians at (4, 6) and (8, 2), default settings.
ACCEPT = [(4.0, 6.0, 100.0, 1.73), (8.0, 2.0, 45.0, 1.2)]


def test_acceptance_map_recovers_both_peaks_and_analytic_volumes() -> None:
    res = find_map_peaks(_map(24, ACCEPT))
    assert len(res["peaks"]) == 2 and res["n_merged"] == 0
    a, b = res["peaks"]
    assert (a["x0"], a["y0"]) == pytest.approx((4.0, 6.0), abs=0.05)
    assert (b["x0"], b["y0"]) == pytest.approx((8.0, 2.0), abs=0.05)
    # Was 1719 (9 % low) and a duplicate on the same hill at (4.35, 5.65).
    assert a["volume"] == pytest.approx(_vol(100, 1.73), rel=0.01)
    assert b["volume"] == pytest.approx(_vol(45, 1.2), rel=0.01)
    assert a["background"] == pytest.approx(5.0, abs=0.2)


def test_the_window_grows_to_the_peak_and_the_table_says_so() -> None:
    res = find_map_peaks(_map(24, ACCEPT))
    a, b = res["peaks"]
    assert a["fit_window"] > 8  # requested 8 cells would cut a 4.1-wide peak's tails
    assert b["fit_window"] >= 8


def test_narrow_window_is_not_the_cause_of_low_volume_any_more() -> None:
    for w in (4, 8, 16):
        first = find_map_peaks(_map(24, ACCEPT), fit_window=w)["peaks"][0]
        assert first["volume"] == pytest.approx(_vol(100, 1.73), rel=0.02)


def test_one_noisy_hill_gives_one_peak_even_with_tiny_separation() -> None:
    pts = _map(60, [(5.0, 5.0, 100.0, 1.5)])
    noise = np.random.default_rng(1).normal(0.0, 1.5, pts.z.shape)
    z = pts.z + noise
    grid = z.reshape(60, 60)
    pts = MapPoints(pts.x, pts.y, z, "X", "um", "Y", "um", "Z", "cts", pts.ux, pts.uy, grid)
    res = find_map_peaks(pts, min_separation=1, smooth_sigma=0.0, threshold=0.2)
    assert res["n_found"] > 1  # the finder does see several noise maxima on the hill
    good = [p for p in res["peaks"] if p["ok"]]
    assert len(good) == 1  # sub-cell noise spikes in the far tail stay in the table, failed
    assert all("under one cell" in p["message"] for p in res["peaks"] if not p["ok"])
    assert good[0]["volume"] == pytest.approx(_vol(100, 1.5), rel=0.05)


def test_n_peaks_cut_applies_after_duplicates_are_dropped() -> None:
    res = find_map_peaks(_map(24, ACCEPT), n_peaks=2, min_separation=1, smooth_sigma=0.0)
    xs = sorted(round(p["x0"]) for p in res["peaks"])
    assert xs == [4, 8]


def test_touching_hills_are_both_found() -> None:
    res = find_map_peaks(_map(60, [(4.0, 5.0, 100.0, 1.0), (6.5, 5.0, 80.0, 1.0)]))
    a, b = res["peaks"]
    assert (a["x0"], b["x0"]) == pytest.approx((4.0, 6.5), abs=0.05)
    assert a["volume"] == pytest.approx(_vol(100, 1.0), rel=0.02)
    assert b["volume"] == pytest.approx(_vol(80, 1.0), rel=0.02)
