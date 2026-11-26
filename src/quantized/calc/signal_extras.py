"""Signal extras: the pure vector maths behind seven extra Signal Processing
operations (Origin gap plan item 7). Each function names the scipy / numpy
routine it delegates to.

``signal_extras_ops`` wraps the ones that build a new axis (coherence,
anti-alias decimation, Zoom FFT) into DataStructs; ``signal_ops`` dispatches
all of them. Same-length operations keep the row order given and never sort.
Where a function cannot give an honest answer on a blank (NaN) row it refuses
rather than inventing a value, unless noted.
"""

from __future__ import annotations

import math
import warnings
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy import signal as sps
from scipy.interpolate import CubicSpline
from scipy.ndimage import convolve1d, percentile_filter

__all__ = [
    "WINDOWS",
    "binomial_kernel",
    "binomial_smooth",
    "coherence_welch",
    "decimate_antialias",
    "extrema_envelope",
    "percentile_smooth",
    "unwrap_phase",
    "zoom_spectrum",
]

Vec = NDArray[np.float64]

#: The window vocabulary of the FFT workbench, mapped to ``scipy.signal.get_window`` names.
WINDOWS: dict[str, str] = {
    "none": "boxcar",
    "hanning": "hann",
    "hamming": "hamming",
    "blackman": "blackman",
    "flattop": "flattop",
}


def _need_finite(y: Vec, what: str) -> None:
    if not np.isfinite(y).all():
        raise ValueError(
            f"{what} needs every row to be a finite number; clean or remove blanks first"
        )


def _odd_window(window: int, n: int, what: str) -> int:
    if int(window) != window or window < 1 or window % 2 == 0:
        raise ValueError(f"{what}: window must be an odd whole number of rows")
    if window > n:
        raise ValueError(f"{what}: window ({window}) is longer than the data ({n} rows)")
    return int(window)


def _window_name(name: str) -> str:
    if name not in WINDOWS:
        raise ValueError(f"unsupported window {name!r} (use {', '.join(WINDOWS)})")
    return WINDOWS[name]


def unwrap_phase(y: Vec, unit: Literal["radians", "degrees"] = "radians") -> Vec:
    """Remove 2*pi (or 360 degree) jumps from a phase column.

    Method: ``numpy.unwrap`` with ``period`` = 2*pi or 360, run over the finite
    rows only; a blank (NaN) row stays blank and the phase continues across it.
    """
    if unit not in ("radians", "degrees"):
        raise ValueError("unit must be radians or degrees")
    yv = np.asarray(y, dtype=float).ravel()
    out = np.full_like(yv, np.nan)
    ok = np.isfinite(yv)
    if ok.any():
        period = 2.0 * math.pi if unit == "radians" else 360.0
        out[ok] = np.unwrap(yv[ok], period=period)
    return out


def percentile_smooth(y: Vec, window: int, percentile: float) -> Vec:
    """Rank (percentile) filter: each row becomes the ``percentile``-th value of
    its centred ``window`` rows (50 = median, 0 = running minimum, 100 = running
    maximum). Method: ``scipy.ndimage.percentile_filter``, edges replicated
    (``mode="nearest"``)."""
    yv = np.asarray(y, dtype=float).ravel()
    _need_finite(yv, "the percentile filter")
    w = _odd_window(window, yv.size, "percentile filter")
    if not (np.isfinite(percentile) and 0.0 <= percentile <= 100.0):
        raise ValueError("percentile must be between 0 and 100")
    return np.asarray(percentile_filter(yv, percentile, size=w, mode="nearest"), dtype=float)


def binomial_kernel(window: int) -> Vec:
    """Normalised binomial coefficients ``C(n, k) / 2**n`` with ``n = window - 1``:
    the discrete approximation of a Gaussian (window 3 -> 1/4, 1/2, 1/4)."""
    if int(window) != window or window < 1 or window % 2 == 0:
        raise ValueError("binomial smoothing: window must be an odd whole number of rows")
    n = int(window) - 1
    coef = np.array([math.comb(n, k) for k in range(n + 1)], dtype=float)
    return np.asarray(coef / coef.sum(), dtype=float)


def binomial_smooth(y: Vec, window: int) -> Vec:
    """Binomial smoothing: convolution with :func:`binomial_kernel`. Method:
    ``scipy.ndimage.convolve1d`` with edges replicated (``mode="nearest"``).
    Preserves a constant and the area of a signal away from the ends."""
    yv = np.asarray(y, dtype=float).ravel()
    _need_finite(yv, "binomial smoothing")
    k = binomial_kernel(window)
    if k.size > yv.size:
        raise ValueError(
            f"binomial smoothing: window ({k.size}) is longer than the data ({yv.size} rows)"
        )
    return np.asarray(convolve1d(yv, k, mode="nearest"), dtype=float)


def _knots(y: Vec, upper: bool, min_distance: int) -> NDArray[np.intp]:
    """Row numbers of the local maxima (or minima) only. The end rows are not
    knots: they are generally mid-carrier, and pinning the envelope there pulls
    it toward the signal (and toward 0 at a zero crossing). With fewer than two
    extrema there is nothing to anchor on, so the end rows are used instead."""
    v = y if upper else -y
    peaks, _ = sps.find_peaks(v, distance=max(1, min_distance))
    if peaks.size >= 2:
        return np.asarray(peaks, dtype=np.intp)
    return np.asarray(np.unique(np.concatenate([[0], peaks, [v.size - 1]])), dtype=np.intp)


def extrema_envelope(
    x: Vec,
    y: Vec,
    side: Literal["upper", "lower"] = "upper",
    interpolation: Literal["spline", "linear"] = "spline",
    min_distance: int = 1,
) -> Vec:
    """Envelope through the local maxima (``upper``) or minima (``lower``).

    Method: ``scipy.signal.find_peaks`` locates the extrema (at least
    ``min_distance`` rows apart); the curve through them is a natural
    ``scipy.interpolate.CubicSpline`` (extrapolated past the first and last
    extremum, which matches Origin's ``envelope`` to 1e-15 on the oracle
    fixture) or ``numpy.interp`` (linear, held flat past the outer extrema).
    A signal with fewer than two extrema is anchored on its end rows. X must be
    strictly increasing. This is the model-free alternative
    to the Hilbert envelope: it needs no uniform axis and no zero-mean carrier.
    """
    if side not in ("upper", "lower"):
        raise ValueError("side must be upper or lower")
    if interpolation not in ("spline", "linear"):
        raise ValueError("interpolation must be spline or linear")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    _need_finite(yv, "the extrema envelope")
    if xv.size < 3 or not np.isfinite(xv).all() or not np.all(np.diff(xv) > 0):
        raise ValueError("the extrema envelope needs at least 3 rows and a strictly increasing X")
    if int(min_distance) != min_distance or min_distance < 1:
        raise ValueError("minimum distance must be a whole number of rows, 1 or more")
    idx = _knots(yv, side == "upper", int(min_distance))
    if interpolation == "linear" or idx.size < 3:
        return np.asarray(np.interp(xv, xv[idx], yv[idx]), dtype=float)
    return np.asarray(CubicSpline(xv[idx], yv[idx], bc_type="natural")(xv), dtype=float)


def decimate_antialias(
    y: NDArray[np.float64],
    factor: int,
    ftype: Literal["iir", "fir"] = "iir",
    order: int | None = None,
    zero_phase: bool = True,
) -> NDArray[np.float64]:
    """Low-pass then keep every ``factor``-th row (rows ``0, q, 2q, ...``).

    Method: ``scipy.signal.decimate`` (Chebyshev type I order-8 IIR, or a
    Hamming-window FIR of order ``20*factor``), zero-phase by default
    (``filtfilt`` / centred FIR). Unlike plain row-keeping this removes content
    above the new Nyquist rate before it can alias. ``y`` may be 2-D (a column
    per channel). IIR is limited to factors of 13 or less, as scipy advises;
    use FIR or decimate in stages beyond that.
    """
    if int(factor) != factor or factor < 2:
        raise ValueError("decimation factor must be a whole number, 2 or more")
    if ftype not in ("iir", "fir"):
        raise ValueError("filter must be iir or fir")
    if ftype == "iir" and factor > 13:
        raise ValueError(
            "IIR decimation is stable only for factors up to 13: use FIR, or decimate in stages"
        )
    if order is not None and (int(order) != order or order < 1):
        raise ValueError("filter order must be a whole number, 1 or more")
    arr = np.asarray(y, dtype=float)
    _need_finite(arr, "anti-alias decimation")
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # a scipy RuntimeWarning means an unusable filter
        try:
            out = sps.decimate(
                arr,
                int(factor),
                n=None if order is None else int(order),
                ftype=ftype,
                axis=0,
                zero_phase=zero_phase,
            )
        except (RuntimeWarning, UserWarning) as exc:
            raise ValueError(f"anti-alias decimation failed: {exc}") from exc
    return np.asarray(out, dtype=float)


def coherence_welch(
    a: Vec,
    b: Vec,
    fs: float,
    window: str = "hanning",
    nperseg: int = 256,
    overlap: float = 0.5,
    detrend: Literal["constant", "linear"] | Literal[False] = "constant",
) -> tuple[Vec, Vec, int]:
    """Magnitude-squared coherence ``|Pab|**2 / (Paa * Pbb)`` by Welch's method.

    Method: ``scipy.signal.coherence`` with ``nperseg`` rows per segment and
    ``overlap`` (a fraction, 0 up to but not including 1) between them.
    Returns ``(frequency, coherence, segments)``. Coherence is 1 for a signal
    with itself and tends to 0, with a positive bias of about 1/segments, for
    independent noise; with a single segment it is trivially 1.
    """
    av = np.asarray(a, dtype=float).ravel()
    bv = np.asarray(b, dtype=float).ravel()
    _need_finite(av, "coherence")
    _need_finite(bv, "coherence")
    if av.size != bv.size or av.size < 8:
        raise ValueError("coherence needs two columns of the same length, at least 8 rows")
    if int(nperseg) != nperseg or nperseg < 4:
        raise ValueError("segment length must be a whole number of rows, 4 or more")
    if not (np.isfinite(overlap) and 0.0 <= overlap < 1.0):
        raise ValueError("overlap must be at least 0 and less than 1")
    seg = min(int(nperseg), av.size)
    noverlap = min(int(round(seg * overlap)), seg - 1)
    n_seg = 1 + (av.size - seg) // (seg - noverlap)
    f, cxy = sps.coherence(
        av, bv, fs=fs, window=_window_name(window), nperseg=seg, noverlap=noverlap, detrend=detrend
    )
    return np.asarray(f, dtype=float), np.asarray(cxy, dtype=float), int(n_seg)


def zoom_spectrum(
    y: Vec,
    fs: float,
    f_lo: float,
    f_hi: float,
    n_points: int = 512,
    window: str = "hanning",
    remove_mean: bool = True,
) -> tuple[Vec, Vec]:
    """Amplitude spectrum evaluated only on ``n_points`` frequencies from
    ``f_lo`` to ``f_hi`` (inclusive).

    Method: ``scipy.signal.ZoomFFT`` (a chirp-z transform) of the windowed
    record, scaled like the FFT workbench's Magnitude output (``2*|Z| /
    sum(window)``) so a sinusoid of amplitude A inside the band reads A. The
    band must lie within 0..fs/2. The record length is unchanged, so the
    intrinsic resolution is still ``fs / n`` (the window's main lobe): zooming
    samples the spectrum finely, it does not sharpen it. It shows peaks that a
    plain FFT of the same record samples too coarsely to separate.
    """
    yv = np.asarray(y, dtype=float).ravel()
    _need_finite(yv, "the Zoom FFT")
    if yv.size < 8:
        raise ValueError("the Zoom FFT needs at least 8 rows")
    nyq = fs / 2.0
    if not (np.isfinite(f_lo) and np.isfinite(f_hi) and 0.0 <= f_lo < f_hi <= nyq):
        raise ValueError(f"the band must satisfy 0 <= low < high <= Nyquist ({nyq:g})")
    if int(n_points) != n_points or not 2 <= n_points <= 100_000:
        raise ValueError("number of points must be a whole number from 2 to 100000")
    win: Vec = np.asarray(sps.get_window(_window_name(window), yv.size), dtype=float)
    rec = yv - float(yv.mean()) if remove_mean else yv
    z = sps.ZoomFFT(yv.size, (f_lo, f_hi), m=int(n_points), fs=fs, endpoint=True)
    spec = np.abs(np.asarray(z(rec * win)))
    freq = np.linspace(f_lo, f_hi, int(n_points))
    scale: Any = np.where((freq > 0.0) & (freq < nyq), 2.0, 1.0)
    return np.asarray(freq, dtype=float), np.asarray(spec * scale / float(win.sum()), dtype=float)
