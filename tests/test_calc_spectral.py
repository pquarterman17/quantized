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


def _hysteresis_loop() -> tuple[np.ndarray, np.ndarray]:
    """A closed there-and-back sweep (M-vs-H loop shape): x returns exactly
    to its starting value, so mean(diff(x)) == (x[-1]-x[0])/(n-1) == 0."""
    up = np.linspace(-1.0, 1.0, 33)
    down = np.linspace(1.0, -1.0, 33)[1:]
    x = np.concatenate([up, down])
    y = np.sin(2 * np.pi * 5 * np.arange(x.size) / x.size)
    return x, y


def test_fft_spectral_on_closed_hysteresis_loop_reports_true_sample_rate() -> None:
    """A closed there-and-back sweep makes mean(diff(x)) == 0.0 exactly --
    the old ``fs = 1.0 / abs(mean(diff(x)))`` raised an uncaught
    ZeroDivisionError. Switching the estimator to
    ``median(abs(diff(x)))`` (step (b)) fixes this case outright: the
    per-sample spacing is well defined even though the net displacement is
    zero, so this must now succeed with the TRUE sampling rate, not merely
    degrade to a 422."""
    x, y = _hysteresis_loop()
    true_spacing = float(np.median(np.abs(np.diff(x))))
    out = fft_spectral(x, y)
    assert out["fs"] == pytest.approx(1.0 / true_spacing)


def test_fft_filter_on_closed_hysteresis_loop_reports_true_sample_rate() -> None:
    """``fft_filter`` doesn't expose ``fs`` directly, but its ``freqPos`` axis
    is derived from it -- its top must reflect the true (nonzero) sample
    spacing rather than raising or silently using a near-infinite fs."""
    x, y = _hysteresis_loop()
    true_spacing = float(np.median(np.abs(np.diff(x))))
    nyquist = 1.0 / (2.0 * true_spacing)
    out = fft_filter(x, y)
    assert out["freqPos"][-1] == pytest.approx(nyquist, rel=0.1)


def test_fft_spectral_on_constant_x_raises_valueerror() -> None:
    """All-equal x (diff is all zero) is the other zero-spacing degenerate
    case; it must also come back as ValueError, not ZeroDivisionError."""
    x = np.full(8, 3.0)
    y = np.arange(8.0)
    with pytest.raises(ValueError, match="sampling rate"):
        fft_spectral(x, y)
