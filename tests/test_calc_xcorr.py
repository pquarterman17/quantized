"""crossCorrelation: golden parity vs MATLAB +utilities/crossCorrelation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.spectral import cross_correlation


@pytest.mark.golden
@pytest.mark.parametrize(
    ("name", "normalize"),
    [("calc_xcorr.json", "coeff"), ("calc_xcorr_none.json", "none")],
)
def test_cross_correlation_matches_matlab(
    name: str,
    normalize: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(name)
    out = cross_correlation(
        np.asarray(g["input"]["x"], dtype=float),
        np.asarray(g["input"]["y"], dtype=float),
        normalize=normalize,
    )
    compare_calc(out, g["output"])


def test_cross_correlation_autocorr_peaks_at_zero() -> None:
    t = np.arange(64.0)
    x = np.sin(2 * np.pi * t / 16)
    r = cross_correlation(x, x)
    assert r["peakLag"] == 0
    assert r["peakValue"] == pytest.approx(1.0)  # coeff-normalized autocorrelation


def test_cross_correlation_recovers_shift() -> None:
    # Aperiodic Gaussian pulse: the |corr| peak unambiguously marks the delay.
    # (A periodic signal would alias the peak onto an equivalent/anti-phase lag.)
    t = np.arange(128.0)
    x = np.exp(-((t - 30.0) ** 2) / (2 * 5.0**2))
    y = np.exp(-((t - 37.0) ** 2) / (2 * 5.0**2))  # x delayed by 7
    r = cross_correlation(x, y)
    assert r["peakLag"] == 7
    assert r["peakValue"] == pytest.approx(1.0, abs=1e-3)


def test_cross_correlation_length_mismatch() -> None:
    with pytest.raises(ValueError, match="equal length"):
        cross_correlation(np.zeros(10), np.zeros(11))
