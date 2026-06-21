"""findPeaksRobust: golden parity vs MATLAB +utilities/findPeaksRobust."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.peaks import find_peaks_robust


@pytest.mark.golden
def test_find_peaks_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_findpeaks.json")
    x = np.asarray(g["input"]["x"], dtype=float)
    y = np.asarray(g["input"]["y"], dtype=float)
    peaks, bg = find_peaks_robust(x, y)
    exp_peaks = g["output"]["peaks"]
    if isinstance(exp_peaks, dict):  # MATLAB encodes a 1-element struct array as an object
        exp_peaks = [exp_peaks]
    compare_calc({"peaks": peaks, "bg": bg}, {"peaks": exp_peaks, "bg": g["output"]["bg"]})


def test_find_peaks_locates_two_gaussians() -> None:
    x = np.linspace(20.0, 60.0, 400)
    y = 100 + 2 * x + 5000 * np.exp(-((x - 30) / 0.4) ** 2) + 4000 * np.exp(-((x - 45) / 0.5) ** 2)
    peaks, _ = find_peaks_robust(x, y)
    centers = sorted(p["center"] for p in peaks)
    assert len(peaks) == 2
    assert centers[0] == pytest.approx(30.0, abs=0.2)
    assert centers[1] == pytest.approx(45.0, abs=0.2)
    # peaks are returned sorted by center ascending
    assert [p["center"] for p in peaks] == sorted(p["center"] for p in peaks)


def test_find_peaks_status_is_auto() -> None:
    x = np.linspace(0.0, 40.0, 400)
    y = 10 + 3000 * np.exp(-((x - 20) / 0.5) ** 2)
    peaks, _ = find_peaks_robust(x, y)
    assert peaks
    assert all(p["status"] == "auto" for p in peaks)
    assert all(np.isnan(p["area"]) and np.isnan(p["eta"]) for p in peaks)


def test_find_peaks_short_signal_empty() -> None:
    peaks, bg = find_peaks_robust([0.0, 1.0, 2.0, 3.0], [1.0, 2.0, 1.0, 2.0])
    assert peaks == []
    np.testing.assert_array_equal(bg, [1.0, 2.0, 1.0, 2.0])
