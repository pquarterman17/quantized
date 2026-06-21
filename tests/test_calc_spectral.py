"""fftSpectral + fftFilter: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.spectral import fft_filter, fft_spectral


def _xy(g: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray(g["input"]["x"], dtype=float),
        np.asarray(g["input"]["y"], dtype=float),
    )


@pytest.mark.golden
def test_fft_psd_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fft_psd.json")
    x, y = _xy(g)
    compare_calc(fft_spectral(x, y), g["output"])


@pytest.mark.golden
def test_fft_magnitude_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fft_magnitude.json")
    x, y = _xy(g)
    compare_calc(fft_spectral(x, y, window="hamming", output_type="magnitude"), g["output"])


@pytest.mark.golden
def test_fft_twosided_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fft_twosided.json")
    x, y = _xy(g)
    compare_calc(fft_spectral(x, y, sided="two"), g["output"])


@pytest.mark.golden
def test_fft_welch_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fft_welch.json")
    x, y = _xy(g)
    compare_calc(fft_spectral(x, y, segment_len=128, window="hanning"), g["output"])


@pytest.mark.golden
def test_fftfilter_lowpass_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fftfilter_lowpass.json")
    x, y = _xy(g)
    compare_calc(fft_filter(x, y, filter_type="lowpass", cutoff=8), g["output"])


@pytest.mark.golden
def test_fftfilter_bandpass_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fftfilter_bandpass.json")
    x, y = _xy(g)
    out = fft_filter(x, y, filter_type="bandpass", cutoff=[8, 15], window="hanning")
    compare_calc(out, g["output"])


def test_fft_psd_peak_at_dominant_tone() -> None:
    # 5 Hz tone should dominate the one-sided PSD.
    x = np.arange(0.0, 5.0, 0.01)
    y = np.sin(2 * np.pi * 5 * x)
    r = fft_spectral(x, y, window="none")
    peak_freq = r["freq"][int(np.argmax(r["psd"]))]
    assert abs(peak_freq - 5.0) < 0.5


def test_fft_filter_lowpass_attenuates_high_tone() -> None:
    x = np.arange(0.0, 5.0, 0.01)
    y = np.sin(2 * np.pi * 5 * x) + np.sin(2 * np.pi * 30 * x)
    r = fft_filter(x, y, filter_type="lowpass", cutoff=10, detrend=False)
    # High-frequency content removed -> filtered variance below original.
    assert np.var(r["yFiltered"]) < np.var(y)
