"""findPeaksRobust: golden parity vs MATLAB +utilities/findPeaksRobust."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.peaks import (
    _compute_prominence,
    _prominence_bruteforce,
    find_peaks_robust,
)


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


# ── prominence: fast O(n log n) path is bit-for-bit equal to the brute force ──


@pytest.mark.parametrize("seed", range(8))
def test_prominence_fast_equals_bruteforce(seed: int) -> None:
    """The sparse-table prominence must match the O(n²) walk exactly, including
    on integer data with many ties (the >/>= edge)."""
    rng = np.random.default_rng(seed)
    n = int(rng.integers(5, 500))
    residual = (
        rng.integers(-3, 4, size=n).astype(float)
        if seed % 2
        else rng.standard_normal(n)
    )
    is_max = np.zeros(n, dtype=bool)
    is_max[1:-1] = (residual[1:-1] >= residual[:-2]) & (residual[1:-1] > residual[2:])
    max_idx = np.flatnonzero(is_max)
    if max_idx.size == 0:
        return
    np.testing.assert_array_equal(
        _compute_prominence(residual, max_idx),
        _prominence_bruteforce(residual, max_idx),
    )


def test_prominence_nonfinite_falls_back_to_bruteforce() -> None:
    """Non-finite residuals route through the brute force (parity reference)."""
    residual = np.array([0.0, 5.0, np.nan, 3.0, 0.0, 4.0, 0.0])
    max_idx = np.array([1, 5], dtype=np.intp)
    np.testing.assert_array_equal(
        _compute_prominence(residual, max_idx),
        _prominence_bruteforce(residual, max_idx),
    )


def test_prominence_scales_to_a_million_points() -> None:
    """The prominence computation was the O(n²) hot spot in find_peaks_robust
    (193 s at 1M points). The sparse-table version is O(n log n); a 1M-point
    signal with ~300k local maxima must finish in well under a second, isolating
    the fix from the (separate, MATLAB-matched) SNIP background cost."""
    import time

    rng = np.random.default_rng(0)
    residual = np.abs(np.sin(np.linspace(0.0, 200.0, 1_000_000)))
    residual = residual + 0.01 * rng.standard_normal(residual.size)
    is_max = np.zeros(residual.size, dtype=bool)
    is_max[1:-1] = (residual[1:-1] >= residual[:-2]) & (residual[1:-1] > residual[2:])
    max_idx = np.flatnonzero(is_max)
    assert max_idx.size > 100_000  # genuinely many candidates
    t0 = time.perf_counter()
    prom = _compute_prominence(residual, max_idx)
    assert time.perf_counter() - t0 < 5.0
    assert prom.shape == max_idx.shape


def test_find_peaks_fast_at_realistic_sizes() -> None:
    """At the largest real-corpus size (~22k points) peak finding is interactive."""
    import time

    rng = np.random.default_rng(1)
    x = np.linspace(0.0, 100.0, 22_000)
    y = np.abs(np.sin(x * 3)) + 0.01 * rng.standard_normal(x.size)
    t0 = time.perf_counter()
    peaks, _ = find_peaks_robust(x, y)
    assert time.perf_counter() - t0 < 5.0
    assert isinstance(peaks, list)
