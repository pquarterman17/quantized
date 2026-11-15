"""Row-order signal filters: median, despike, LOWESS, kernel convolution /
Wiener deconvolution, Hilbert envelope. Pure numpy/scipy (gap audit 4, G6).

Every function here works on 1-D float vectors **in the row order given**. None
of them sorts: a hysteresis loop or a time-ordered sweep keeps its acquisition
order, and "neighbour" means the adjacent row (median, despike) or the nearest
in X (LOWESS, which needs no ordering). The two that assume a uniform axis
(convolution / deconvolution / Hilbert) *refuse* a non-uniform or non-monotonic
X (:func:`require_uniform`) and say to resample first, rather than silently
treating an uneven axis as even.

Non-finite values are never invented: they stay NaN in the output.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from numpy.typing import NDArray
from scipy import fft as sfft
from scipy.ndimage import convolve1d
from scipy.signal import hilbert

__all__ = [
    "KernelShape",
    "deconvolve_wiener",
    "convolve_kernel",
    "despike",
    "hilbert_envelope",
    "kernel_samples",
    "lowess",
    "median_filter",
    "require_uniform",
]

Vec = NDArray[np.float64]
KernelShape = Literal["gaussian", "lorentzian"]

#: LOWESS is O(n^2) (one nearest-neighbour search per row); refuse beyond this.
LOWESS_MAX_ROWS = 20000


def _window(window: int, n: int) -> int:
    if int(window) != window or window < 1:
        raise ValueError("window must be a positive integer")
    w = int(window)
    if w % 2 == 0:
        raise ValueError("window must be odd (it is centred on each row)")
    if w > n:
        raise ValueError(f"window ({w}) is longer than the data ({n} rows)")
    return w


def _rolling_median(y: Vec, window: int) -> Vec:
    """Centred rolling median over ``window`` rows; edges replicate the end
    value; NaN neighbours are ignored (an all-NaN window gives NaN)."""
    half = window // 2
    padded = np.concatenate([np.full(half, y[0]), y, np.full(half, y[-1])])
    win = sliding_window_view(padded, window)
    out = np.full(y.size, np.nan)
    ok = np.isfinite(win).any(axis=1)
    if bool(ok.any()):
        out[ok] = np.nanmedian(win[ok], axis=1)
    return np.asarray(out, dtype=float)


def median_filter(y: Vec, window: int) -> Vec:
    """Centred running median of ``window`` (odd) rows. Edges replicate the end
    value. Rows whose own value is NaN stay NaN."""
    arr = np.asarray(y, dtype=float).ravel()
    w = _window(window, arr.size)
    out = _rolling_median(arr, w)
    return np.asarray(np.where(np.isfinite(arr), out, np.nan), dtype=float)


def _monotonic(x: Vec) -> bool:
    d = np.diff(x[np.isfinite(x)])
    return bool(d.size == 0 or np.all(d >= 0) or np.all(d <= 0))


def _hampel(y: Vec, window: int) -> tuple[Vec, Vec]:
    """Per-row window median and window MAD (the Hampel identifier): the MAD is
    the median |value - window median| over the same window, so a smooth slope
    or a real peak widens it and protects itself from being flagged. Windows
    shrink at the ends (NaN padding): replicating the end value would collapse
    the MAD there and flag ordinary end points."""
    half = window // 2
    padded = np.concatenate([np.full(half, np.nan), y, np.full(half, np.nan)])
    win = sliding_window_view(padded, window)
    med = np.full(y.size, np.nan)
    mad = np.full(y.size, np.nan)
    ok = np.isfinite(win).any(axis=1)
    if bool(ok.any()):
        m = np.nanmedian(win[ok], axis=1)
        med[ok] = m
        mad[ok] = np.nanmedian(np.abs(win[ok] - m[:, None]), axis=1)
    return np.asarray(med, dtype=float), np.asarray(mad, dtype=float)


def despike(
    y: Vec, window: int, threshold: float, x: Vec | None = None
) -> tuple[Vec, NDArray[np.bool_]]:
    """Rolling median/MAD (Hampel) spike removal.

    A row is a spike when ``|y - median| > threshold * 1.4826 * MAD`` over the
    centred ``window``. Where the window MAD is 0 (a flat run) the column's
    global MAD of ``y - rolling median`` stands in; if that is 0 too, any
    departure from the median is a spike. Spikes are replaced by linear
    interpolation between the surviving neighbours, against ``x`` when it is
    monotonic and against the row index otherwise (a hysteresis loop is never
    sorted). Returns ``(cleaned, mask)``.
    """
    arr = np.asarray(y, dtype=float).ravel()
    if not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("threshold must be a positive number of MADs")
    w = _window(window, arr.size)
    med, mad = _hampel(arr, w)
    dev = np.abs(arr - med)
    glob = float(np.nanmedian(dev)) if np.isfinite(dev).any() else 0.0
    sigma = 1.4826 * np.where(mad > 0, mad, glob)
    with np.errstate(invalid="ignore"):
        mask = np.isfinite(dev) & (dev > threshold * sigma)
    cleaned = arr.copy()
    if mask.any():
        good = np.isfinite(arr) & ~mask
        if int(good.sum()) < 2:
            raise ValueError("too few non-spike points to interpolate over")
        axis = np.arange(arr.size, dtype=float)
        if x is not None:
            xv = np.asarray(x, dtype=float).ravel()
            if xv.size == arr.size and np.isfinite(xv[good]).all() and _monotonic(xv):
                axis = xv
        gx, gy = axis[good], arr[good]
        if gx[0] > gx[-1]:  # descending axis: np.interp wants ascending
            gx, gy = gx[::-1], gy[::-1]
        cleaned[mask] = np.interp(axis[mask], gx, gy)
    return cleaned, mask


def lowess(x: Vec, y: Vec, frac: float = 0.3, iterations: int = 3) -> Vec:
    """Locally weighted linear regression (Cleveland 1979), evaluated at every
    row's own X in the order given (no sorting).

    Each point fits a straight line to its ``k = int(frac*n)`` nearest points in
    X with tricube weights; ``iterations`` extra passes down-weight outliers
    with bisquare weights on the residuals (6 x median |residual|). Same
    algorithm as ``statsmodels.nonparametric.lowess`` (a local implementation:
    statsmodels is only an optional extra); see tests for the cross-check.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    ok = np.isfinite(xv) & np.isfinite(yv)
    n = int(ok.sum())
    if not 0 < frac <= 1:
        raise ValueError("fraction must be in (0, 1]")
    if iterations < 0 or int(iterations) != iterations:
        raise ValueError("iterations must be a non-negative integer")
    k = max(2, int(frac * n + 1e-10))
    if n < 3 or k > n:
        raise ValueError("LOWESS needs at least 3 finite points")
    if n > LOWESS_MAX_ROWS:
        raise ValueError(f"LOWESS is limited to {LOWESS_MAX_ROWS} rows (got {n}); resample first")
    fx, fy = xv[ok], yv[ok]
    robust = np.ones(n)
    fit = np.empty(n)
    for it in range(int(iterations) + 1):
        for i in range(n):
            d = np.abs(fx - fx[i])
            idx = np.argpartition(d, k - 1)[:k]
            h = float(d[idx].max())
            dd = d[idx]
            w = np.ones(k) if h <= 0 else (1.0 - np.minimum(dd / h, 1.0) ** 3) ** 3
            w = w * robust[idx]
            sw = float(w.sum())
            if sw <= 0:
                fit[i] = fy[i]
                continue
            mx = float((w * fx[idx]).sum() / sw)
            my = float((w * fy[idx]).sum() / sw)
            sxx = float((w * (fx[idx] - mx) ** 2).sum())
            if sxx <= 1e-12 * max(h * h * sw, 1e-300):
                fit[i] = my
            else:
                slope = float((w * (fx[idx] - mx) * (fy[idx] - my)).sum() / sxx)
                fit[i] = my + slope * (fx[i] - mx)
        if it == iterations:
            break
        res = fy - fit
        s = float(np.median(np.abs(res)))
        if s <= 0:
            break
        u = np.clip(res / (6.0 * s), -1.0, 1.0)
        robust = (1.0 - u * u) ** 2
    out = np.full(xv.size, np.nan)
    out[ok] = fit
    return np.asarray(out, dtype=float)


def require_uniform(x: Vec, what: str, rtol: float = 0.01) -> float:
    """The (signed) constant X step, or a ValueError saying to resample first."""
    xv = np.asarray(x, dtype=float).ravel()
    if xv.size < 3 or not np.isfinite(xv).all():
        raise ValueError(f"{what} needs at least 3 rows and a finite X on every row")
    d = np.diff(xv)
    step = float(np.median(d))
    if step == 0 or not np.all(np.abs(d - step) <= rtol * abs(step)):
        raise ValueError(
            f"{what} needs a uniform, monotonic X axis (steps differ by more than "
            f"{rtol:.0%}, or X reverses); resample onto a uniform grid first"
        )
    return step


def kernel_samples(shape: KernelShape, fwhm: float, dx: float) -> Vec:
    """Odd-length, centred, unit-sum kernel of full width at half maximum
    ``fwhm`` (X units) sampled at spacing ``|dx|``. Gaussian spans +/-3 FWHM,
    Lorentzian +/-10 FWHM (long tails)."""
    if shape not in ("gaussian", "lorentzian"):
        raise ValueError("kernel must be gaussian or lorentzian")
    step = abs(dx)
    if not (math.isfinite(fwhm) and fwhm > 0):
        raise ValueError("kernel width (FWHM) must be positive")
    half = max(1, int(math.ceil((3.0 if shape == "gaussian" else 10.0) * fwhm / step)))
    if half > 100_000:
        raise ValueError(
            "kernel is over 200,000 samples wide; use a narrower width or resample first"
        )
    t = np.arange(-half, half + 1, dtype=float) * step
    if shape == "gaussian":
        k = np.exp(-4.0 * math.log(2.0) * (t / fwhm) ** 2)
    else:
        k = 1.0 / (1.0 + (2.0 * t / fwhm) ** 2)
    return np.asarray(k / k.sum(), dtype=float)


def _fill(y: Vec) -> Vec:
    if not np.isfinite(y).all():
        raise ValueError(
            "convolution / deconvolution needs finite values; fill or remove gaps first"
        )
    return y


def convolve_kernel(x: Vec, y: Vec, shape: KernelShape, fwhm: float) -> Vec:
    """Convolve with a unit-area Gaussian/Lorentzian kernel (same length;
    reflected edges). Needs a uniform X."""
    yv = _fill(np.asarray(y, dtype=float).ravel())
    k = kernel_samples(shape, fwhm, require_uniform(x, "convolution"))
    return np.asarray(convolve1d(yv, k, mode="reflect"), dtype=float)


def deconvolve_wiener(
    x: Vec, y: Vec, shape: KernelShape, fwhm: float, regularisation: float = 1e-3
) -> Vec:
    """Regularised Wiener deconvolution of a known kernel.

    ``X = Y * conj(H) / (|H|^2 + lambda)`` in the frequency domain, with the
    unit-area kernel's ``|H(0)| = 1`` so ``lambda`` is a noise-to-signal power
    ratio (larger = smoother, less ringing). The record is reflect-padded to
    suppress wrap-around.
    """
    if not (math.isfinite(regularisation) and regularisation > 0):
        raise ValueError("regularisation must be positive (it keeps the inverse stable)")
    yv = _fill(np.asarray(y, dtype=float).ravel())
    k = kernel_samples(shape, fwhm, require_uniform(x, "deconvolution"))
    half = k.size // 2
    pad = min(2 * half, yv.size - 1)
    ext = np.pad(yv, pad, mode="reflect") if pad else yv
    n = sfft.next_fast_len(ext.size + k.size)
    kern = np.zeros(n)
    kern[: k.size] = k
    kern = np.roll(kern, -half)  # centre the kernel on index 0
    big_h = sfft.rfft(kern)
    big_y = sfft.rfft(ext, n)
    est = sfft.irfft(big_y * np.conj(big_h) / (np.abs(big_h) ** 2 + regularisation), n)
    return np.asarray(est[pad : pad + yv.size], dtype=float)


def hilbert_envelope(
    x: Vec, y: Vec, *, remove_mean: bool = True, output: Literal["envelope", "hilbert"] = "envelope"
) -> Vec:
    """Hilbert-transform amplitude envelope ``|y + i H[y]|`` (``scipy.signal.hilbert``),
    or the transform ``H[y]`` itself. The mean is removed first by default (a
    DC offset would otherwise sit under the whole envelope). Needs a uniform X."""
    require_uniform(x, "the Hilbert transform")
    yv = _fill(np.asarray(y, dtype=float).ravel())
    if remove_mean:
        yv = yv - float(yv.mean())
    analytic = hilbert(yv)
    if output == "hilbert":
        return np.asarray(np.imag(analytic), dtype=float)
    return np.asarray(np.abs(analytic), dtype=float)
