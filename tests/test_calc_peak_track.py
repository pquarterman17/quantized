"""Peak tracking across a dataset series: golden parity vs MATLAB fitting.trackPeak."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.peak_track import track_peak
from quantized.datastruct import DataStruct


@pytest.mark.golden
@pytest.mark.parametrize("shape", ["gaussian", "lorentzian"])
def test_track_peak_matches_matlab(
    shape: str, load_golden: Callable[[str], dict[str, Any]]
) -> None:
    g = load_golden("calc_trackpeak.json")
    x = np.asarray(g["x"], dtype=float)
    blk = g[shape]
    datasets = [(x, np.asarray(yi, dtype=float)) for yi in blk["y"]]
    r = track_peak(datasets, g["seed"], window=g["window"], shape=shape)
    ref = blk["result"]
    assert r["found"] == [bool(v) for v in ref["found"]]
    for key in ("center", "height", "fwhm", "area", "R2"):
        assert_allclose(
            np.asarray(r[key], dtype=float),
            np.asarray(ref[key], dtype=float).ravel(),
            rtol=1e-6, atol=1e-8, err_msg=f"{shape}.{key}",
        )


def _drifting_series(centers: list[float]) -> list[tuple[np.ndarray, np.ndarray]]:
    x = np.linspace(40.0, 50.0, 200)
    return [(x, 100.0 * np.exp(-((x - c) ** 2) / (2 * 0.5**2)) + 2.0) for c in centers]


def test_track_follows_drifting_peak() -> None:
    centers = [45.0, 45.4, 45.9, 46.5]
    r = track_peak(_drifting_series(centers), 45.0, window=2.0, shape="gaussian")
    assert all(r["found"])
    assert_allclose(r["center"], centers, atol=1e-2)


def test_no_follow_loses_peak_that_drifts_out_of_window() -> None:
    # Peak migrates far; without follow the fixed window around the seed loses it.
    centers = [45.0, 46.0, 47.5, 49.0]
    r = track_peak(_drifting_series(centers), 45.0, window=1.0, shape="gaussian", follow=False)
    assert r["found"][0] is True
    assert r["found"][-1] is False  # 49.0 is outside [44, 46]


def test_min_height_filters_small_peaks() -> None:
    x = np.linspace(40.0, 50.0, 200)
    small = (x, 5.0 * np.exp(-((x - 45.0) ** 2) / (2 * 0.5**2)) + 1.0)
    r = track_peak([small], 45.0, window=2.0, shape="gaussian", min_height=50.0)
    assert r["found"] == [False]


def test_track_peak_accepts_datastruct() -> None:
    x = np.linspace(40.0, 50.0, 200)
    y = 100.0 / (1.0 + ((x - 45.5) / 0.5) ** 2) + 2.0
    ds = DataStruct.create(x, y, labels=["I"], units=["a.u."], metadata={})
    r = track_peak([ds], 45.0, window=2.0, shape="lorentzian")
    assert r["found"] == [True]
    assert r["center"][0] == pytest.approx(45.5, abs=1e-2)


def test_invalid_shape_raises() -> None:
    x = np.linspace(40.0, 50.0, 50)
    with pytest.raises(ValueError, match="gaussian"):
        track_peak([(x, x)], 45.0, shape="voigt")


def test_empty_series_returns_zero_datasets() -> None:
    r = track_peak([], 45.0)
    assert r["nDatasets"] == 0
    assert r["center"] == []
