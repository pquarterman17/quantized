"""FFT spectral analysis + frequency-domain filtering. Ports of MATLAB +utilities.

Pure calc layer. ``fft_spectral`` computes PSD / magnitude / phase / complex
spectra (one- or two-sided, optional Welch averaging); ``fft_filter`` applies a
Butterworth-shaped frequency-domain filter. Windows, ``nextpow2`` nfft sizing,
the frequency axis and fftshift conventions all match MATLAB exactly.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["cross_correlation", "fft_filter", "fft_spectral"]

_EPS = float(np.finfo(float).eps)
_TWO_PI = 2.0 * math.pi


def _nextpow2(n: int) -> int:
    return int(math.ceil(math.log2(n)))


def _matlab_round(x: float) -> int:
    """Round half away from zero (MATLAB ``round``), not banker's rounding."""
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


def _bessel_i0(x: NDArray[np.float64]) -> NDArray[np.float64]:
    """Modified Bessel I0 via 25-term series (matches MATLAB helper exactly)."""
    y = np.ones_like(x)
    term = np.ones_like(x)
    for k in range(1, 26):
        term = term * (x / (2 * k)) ** 2
        y = y + term
    return y


def _make_window(name: str, n: int, kaiser_beta: float) -> NDArray[np.float64]:
    idx = np.arange(n, dtype=float)
    if name == "none":
        return np.ones(n)
    if name == "hanning":
        return 0.5 * (1 - np.cos(_TWO_PI * idx / (n - 1)))
    if name == "hamming":
        return 0.54 - 0.46 * np.cos(_TWO_PI * idx / (n - 1))
    if name == "blackman":
        return (
            0.42
            - 0.5 * np.cos(_TWO_PI * idx / (n - 1))
            + 0.08 * np.cos(2 * _TWO_PI * idx / (n - 1))
        )
    if name == "flattop":
        a = (0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368)
        return np.asarray(
            a[0]
            - a[1] * np.cos(_TWO_PI * idx / (n - 1))
            + a[2] * np.cos(2 * _TWO_PI * idx / (n - 1))
            - a[3] * np.cos(3 * _TWO_PI * idx / (n - 1))
            + a[4] * np.cos(4 * _TWO_PI * idx / (n - 1)),
            dtype=float,
        )
    if name == "kaiser":
        alpha = (n - 1) / 2.0
        arg = kaiser_beta * np.sqrt(1 - ((idx - alpha) / alpha) ** 2)
        return np.asarray(_bessel_i0(arg) / _bessel_i0(np.asarray(kaiser_beta)), dtype=float)
    raise ValueError(f"unknown window {name!r}")


def _detrend(y: NDArray[np.float64], x: NDArray[np.float64], mode: str) -> NDArray[np.float64]:
    if mode == "mean":
        return np.asarray(y - np.mean(y), dtype=float)
    if mode == "linear":
        coeffs = np.polyfit(x, y, 1)
        return np.asarray(y - np.polyval(coeffs, x), dtype=float)
    return y


def _two_sided_freq(nfft: int, df: float) -> NDArray[np.float64]:
    """MATLAB ``(-floor(nfft/2):ceil(nfft/2)-1)*df`` == fftshift bin order."""
    return np.asarray((np.arange(nfft) - (nfft // 2)) * df, dtype=float)


def cross_correlation(
    x: ArrayLike, y: ArrayLike, *, normalize: str = "coeff"
) -> dict[str, Any]:
    """FFT-based cross-correlation of two equal-length signals. Port of crossCorrelation.

    Returns ``lags`` (-(N-1)..N-1), the cross-correlation ``xcorr``, and the peak
    lag/value (by largest magnitude). ``normalize='coeff'`` divides by
    ``sqrt(sum(x^2) * sum(y^2))`` so an autocorrelation peaks at 1.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"signals must have equal length (got {xv.size} and {yv.size})")
    n = xv.size
    if n < 2:
        raise ValueError("need at least 2 data points")

    nfft = 2 ** _nextpow2(2 * n - 1)
    rxy = np.real(np.fft.ifft(np.conj(np.fft.fft(xv, nfft)) * np.fft.fft(yv, nfft)))
    xcorr = np.concatenate([rxy[nfft - n + 1 : nfft], rxy[:n]])
    lags = np.arange(-(n - 1), n)
    if normalize == "coeff":
        denom = math.sqrt(float(np.sum(xv**2)) * float(np.sum(yv**2)))
        if denom > 0:
            xcorr = xcorr / denom
    i_peak = int(np.argmax(np.abs(xcorr)))
    return {
        "lags": lags,
        "xcorr": xcorr,
        "peakLag": int(lags[i_peak]),
        "peakValue": float(xcorr[i_peak]),
    }


def fft_spectral(
    x: ArrayLike,
    y: ArrayLike,
    *,
    window: str = "hanning",
    kaiser_beta: float = 5.0,
    output_type: str = "psd",
    sided: str = "one",
    detrend: str = "mean",
    zero_pad: int = 0,
    overlap: float = 0.5,
    segment_len: int = 0,
) -> dict[str, Any]:
    """Single-record or Welch-averaged FFT spectrum. Port of utilities.fftSpectral.

    ``output_type`` selects ``psd`` | ``magnitude`` | ``phase`` (degrees) |
    ``complex``. With ``segment_len > 0`` a Welch PSD is returned (segments of
    ``segment_len`` with fractional ``overlap``). One-sided spectra fold interior
    bins (x2); the sampling rate is inferred from the mean x-spacing.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = xv.size
    if n < 4:
        raise ValueError("need at least 4 data points")
    fs = 1.0 / abs(float(np.mean(np.diff(xv))))

    if segment_len > 0:
        return _welch_psd(
            yv, fs, window, kaiser_beta, sided, detrend, zero_pad, overlap, segment_len
        )

    yd = _detrend(yv, xv, detrend)
    win = _make_window(window, n, kaiser_beta)
    y_win = yd * win
    nfft = max(zero_pad, n) if zero_pad > 0 else 2 ** _nextpow2(n)
    spectrum = np.fft.fft(y_win, nfft)
    df = fs / nfft
    s1 = float(win.sum())
    s2 = float((win**2).sum())

    out: dict[str, Any] = {}
    if sided == "one":
        n_half = nfft // 2 + 1
        freq = np.arange(n_half) * df
        yh = spectrum[:n_half]
        if output_type == "psd":
            val = (np.abs(yh) ** 2) / (fs * s2)
            val[1:-1] *= 2
            out["psd"] = val
        elif output_type == "magnitude":
            mag = np.abs(yh) / s1
            mag[1:-1] *= 2
            out["magnitude"] = mag
        elif output_type == "phase":
            out["phase"] = np.degrees(np.angle(yh))
        else:  # complex
            out["spectrum"] = yh
        out["freq"] = freq
    else:
        freq = _two_sided_freq(nfft, df)
        y_shift = np.fft.fftshift(spectrum)
        if output_type == "psd":
            out["psd"] = (np.abs(y_shift) ** 2) / (fs * s2)
        elif output_type == "magnitude":
            out["magnitude"] = np.abs(y_shift) / s1
        elif output_type == "phase":
            out["phase"] = np.degrees(np.angle(y_shift))
        else:  # complex
            out["spectrum"] = y_shift
        out["freq"] = freq

    out.update(window=win, df=df, nfft=nfft, fs=fs, windowName=window)
    return out


def _welch_psd(
    y: NDArray[np.float64],
    fs: float,
    window: str,
    kaiser_beta: float,
    sided: str,
    detrend: str,
    zero_pad: int,
    overlap: float,
    segment_len: int,
) -> dict[str, Any]:
    n = y.size
    seg_len = min(segment_len, n)
    if seg_len < 4:
        raise ValueError("segment_len must be >= 4")
    step = seg_len - _matlab_round(seg_len * overlap)
    # overlap >= 1 (or any value making the hop <= 0) would make the segment loop
    # below never advance -> infinite loop. Clamp to a 1-sample hop (max overlap).
    step = max(step, 1)
    nfft = max(zero_pad, seg_len) if zero_pad > 0 else 2 ** _nextpow2(seg_len)
    df = fs / nfft
    win = _make_window(window, seg_len, kaiser_beta)
    s2 = float((win**2).sum())
    n_half = nfft // 2 + 1

    n_segs = 0
    idx = 0
    while idx + seg_len <= n:
        n_segs += 1
        idx += step
    n_segs = max(n_segs, 1)

    accum = np.zeros(n_half if sided == "one" else nfft)
    idx = 0
    n_actual = 0
    for _ in range(n_segs):
        if idx + seg_len > n:
            break
        seg = y[idx : idx + seg_len]
        seg = _detrend(seg, np.arange(seg_len, dtype=float), detrend)
        spectrum = np.fft.fft(seg * win, nfft)
        if sided == "one":
            yh = spectrum[:n_half]
            p_seg = (np.abs(yh) ** 2) / (fs * s2)
            p_seg[1:-1] *= 2
            accum = accum + p_seg
        else:
            accum = accum + (np.abs(spectrum) ** 2) / (fs * s2)
        n_actual += 1
        idx += step
    accum = accum / max(n_actual, 1)

    if sided == "one":
        freq = np.arange(n_half) * df
    else:
        freq = _two_sided_freq(nfft, df)
        accum = np.fft.fftshift(accum)
    return {
        "freq": freq,
        "psd": accum,
        "window": win,
        "df": df,
        "nfft": nfft,
        "fs": fs,
        "windowName": window,
    }


def fft_filter(
    x: ArrayLike,
    y: ArrayLike,
    *,
    filter_type: str = "lowpass",
    cutoff: float | ArrayLike | None = None,
    bandwidth: float | None = None,
    order: int = 4,
    window: str = "none",
    detrend: bool = True,
) -> dict[str, Any]:
    """Frequency-domain Butterworth-shaped filter. Port of utilities.fftFilter.

    ``filter_type`` is ``lowpass`` | ``highpass`` | ``bandpass`` | ``notch``.
    ``cutoff`` is a scalar (lowpass/highpass/notch center) or ``[low, high]``
    (bandpass); it defaults to Nyquist/4. Returns the filtered signal plus the
    transfer function and one-/two-sided power spectra.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = xv.size
    if n < 4:
        raise ValueError("need at least 4 data points")
    fs = 1.0 / abs(float(np.mean(np.diff(xv))))
    f_nyq = fs / 2.0

    if cutoff is None:
        cut = np.array([f_nyq / 4.0])
    else:
        cut = np.atleast_1d(np.asarray(cutoff, dtype=float))

    if filter_type == "bandpass":
        if cut.size != 2:
            raise ValueError("bandpass requires cutoff = [low, high]")
        f_low, f_high = float(cut[0]), float(cut[1])
    elif filter_type == "notch":
        f_center = float(cut[0])
        bw = f_center / 10.0 if bandwidth is None else float(bandwidth)
        f_low, f_high = f_center - bw / 2.0, f_center + bw / 2.0
    elif filter_type == "lowpass":
        f_low, f_high = 0.0, float(cut[0])
    elif filter_type == "highpass":
        f_low, f_high = float(cut[0]), f_nyq
    else:
        raise ValueError(f"unknown filter_type {filter_type!r}")

    if detrend:
        trend = np.polyval(np.polyfit(xv, yv, 1), xv)
    else:
        trend = np.zeros(n)
    yd = yv - trend

    win = _make_window(window, n, 5.0) if window != "none" else np.ones(n)
    spectrum = np.fft.fft(yd * win)
    freq = np.arange(n) * fs / n
    freq = np.where(freq > f_nyq, freq - fs, freq)
    abs_freq = np.abs(freq)

    two_ord = 2 * order
    if filter_type == "lowpass":
        transfer = 1.0 / (1.0 + (abs_freq / max(f_high, _EPS)) ** two_ord)
    elif filter_type == "highpass":
        transfer = 1.0 / (1.0 + (max(f_low, _EPS) / np.maximum(abs_freq, _EPS)) ** two_ord)
        transfer[abs_freq == 0] = 0.0
    else:  # bandpass / notch share the band shape
        h_lp = 1.0 / (1.0 + (abs_freq / max(f_high, _EPS)) ** two_ord)
        h_hp = 1.0 / (1.0 + (max(f_low, _EPS) / np.maximum(abs_freq, _EPS)) ** two_ord)
        h_hp[abs_freq == 0] = 0.0
        h_bp = h_lp * h_hp
        transfer = h_bp if filter_type == "bandpass" else 1.0 - h_bp

    y_filt_freq = spectrum * transfer
    y_filt = np.real(np.fft.ifft(y_filt_freq))
    if window != "none":
        y_filt = y_filt / np.maximum(win, 0.01)
    y_filt = y_filt + trend

    power_orig = np.abs(spectrum) ** 2 / n
    power_filt = np.abs(y_filt_freq) ** 2 / n
    n_half = n // 2 + 1
    freq_pos = np.arange(n_half) * fs / n
    power_pos = 2.0 * power_orig[:n_half] / n
    power_pos[0] = power_pos[0] / 2.0  # DC not doubled

    return {
        "yFiltered": y_filt,
        "freq": freq,
        "power": power_orig,
        "powerFilt": power_filt,
        "transfer": transfer,
        "freqPos": freq_pos,
        "powerPos": power_pos,
    }
