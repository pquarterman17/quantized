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
#: Robust passes beyond this change nothing useful and multiply the O(n^2) cost.
LOWESS_MAX_ITERATIONS = 10


def _window(window: int, n: int) -> int:
    if int(window) != window or window < 1:
        raise ValueError("window must be a positive integer")
    w = int(window)
    if w % 2 == 0:
        raise ValueError("window must be odd (it is centred on each row)")
    if w > n:
        raise ValueError(f"window ({w}) is longer than the data ({n} rows)")
    return w


#: Elements of the row x window matrix materialised per chunk (~8 MB of float64).
#: A few copies live at once.
_CHUNK_ELEMS = 1_000_000
#: Refuse n*window beyond this: the sort-based median is O(n*w log w).
MAX_WINDOW_WORK = 600_000_000


def _window_starts(n: int, w: int) -> NDArray[np.intp]:
    """First row of each row's length-``w`` window: centred, but at the ends the
    window is shifted inward so it keeps its FULL length (shrinking it would
    halve the breakdown point there; replicating the end value would collapse
    the MAD)."""
    half = w // 2
    return np.asarray(np.clip(np.arange(n) - half, 0, n - w), dtype=np.intp)


def _rolling(y: Vec, w: int, with_mad: bool) -> tuple[Vec, Vec]:
    """Per-row window median (and window MAD) over length-``w`` windows, in
    row chunks so memory stays bounded whatever ``n * w`` is. NaN neighbours
    are ignored (an all-NaN window gives NaN)."""
    n = y.size
    if n * w > MAX_WINDOW_WORK:
        raise ValueError(
            f"window {w} on {n} rows is too much work (limit {MAX_WINDOW_WORK:,} row-window "
            "cells); use a smaller window"
        )
    starts = _window_starts(n, w)
    offs = np.arange(w)
    med = np.full(n, np.nan)
    mad = np.full(n, np.nan)
    step = max(1, _CHUNK_ELEMS // w)
    for lo in range(0, n, step):
        hi = min(n, lo + step)
        win = y[starts[lo:hi, None] + offs]
        ok = np.isfinite(win).any(axis=1)
        if not bool(ok.any()):
            continue
        m = np.nanmedian(win[ok], axis=1)
        med[lo:hi][ok] = m
        if with_mad:
            mad[lo:hi][ok] = np.nanmedian(np.abs(win[ok] - m[:, None]), axis=1)
    return np.asarray(med, dtype=float), np.asarray(mad, dtype=float)


def median_filter(y: Vec, window: int) -> Vec:
    """Running median of ``window`` (odd) rows, centred on each row; at the ends
    the window keeps its length and shifts inward (so an end spike is removed).
    Rows whose own value is NaN stay NaN."""
    arr = np.asarray(y, dtype=float).ravel()
    w = _window(window, arr.size)
    out, _ = _rolling(arr, w, False)
    return np.asarray(np.where(np.isfinite(arr), out, np.nan), dtype=float)


def _monotonic(x: Vec) -> bool:
    d = np.diff(x[np.isfinite(x)])
    return bool(d.size == 0 or np.all(d >= 0) or np.all(d <= 0))


def _spike_scale(arr: Vec, med: Vec, dev: Vec, mad: Vec) -> Vec:
    """Per-row noise scale for despike (see :func:`despike` for the fallbacks)."""
    fin = np.isfinite(dev)
    glob = float(np.median(dev[fin])) if fin.any() else 0.0
    if glob > 0:
        fallback = np.full(arr.size, 1.4826 * glob)
    else:
        vals = arr[np.isfinite(arr)]
        counts = vals.size > 0 and bool(np.all(vals >= 0)) and bool(np.all(vals == np.round(vals)))
        mean_dev = float(dev[fin].mean()) if fin.any() else 0.0
        if counts:
            fallback = np.sqrt(np.maximum(np.nan_to_num(med), 1.0))
        elif mean_dev > 0:
            fallback = np.full(arr.size, 1.4826 * mean_dev)
        else:
            fallback = np.full(arr.size, np.inf)
    return np.asarray(np.where(mad > 0, 1.4826 * mad, fallback), dtype=float)


def despike(
    y: Vec, window: int, threshold: float, x: Vec | None = None
) -> tuple[Vec, NDArray[np.bool_]]:
    """Rolling median/MAD (Hampel) spike removal.

    A row is a spike when ``|y - median| > threshold * 1.4826 * MAD`` over its
    ``window`` (full length even at the ends). Where the window MAD is 0 the
    column's global MAD of ``y - rolling median`` stands in; if that is 0 too:
    non-negative INTEGER data (counts) uses the Poisson spread
    ``sqrt(max(median, 1))`` so sparse counts are not destroyed; other data uses
    the mean absolute deviation; a perfectly constant column has nothing to
    flag. Spikes are replaced by linear
    interpolation between the surviving neighbours, against ``x`` when it is
    monotonic and against the row index otherwise (a hysteresis loop is never
    sorted). Returns ``(cleaned, mask)``.
    """
    arr = np.asarray(y, dtype=float).ravel()
    if not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("threshold must be a positive number of MADs")
    w = _window(window, arr.size)
    med, mad = _rolling(arr, w, True)
    dev = np.abs(arr - med)
    sigma = _spike_scale(arr, med, dev, mad)
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

    REFUSES an X that reverses direction: neighbours are chosen by distance in
    X, so on a hysteresis loop both branches occupy the same X and every local
    fit would average them (the loop collapses). Split the branches first.

    Each point fits a straight line to its ``k = int(frac*n)`` nearest points in
    X with tricube weights; ``iterations`` extra passes down-weight outliers
    with bisquare weights on the residuals (6 x median |residual|). Follows
    ``statsmodels.nonparametric.lowess`` (matches it to ~1e-15 for ``frac`` of
    about 0.03 and up; at a handful of points per fit the two differ, because
    statsmodels falls back to the raw value where fewer than two weights are
    non-zero and this fits the line anyway). Local implementation: statsmodels
    is only an optional extra.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    ok = np.isfinite(xv) & np.isfinite(yv)
    n = int(ok.sum())
    if not 0 < frac <= 1:
        raise ValueError("fraction must be in (0, 1]")
    if iterations < 0 or int(iterations) != iterations or iterations > LOWESS_MAX_ITERATIONS:
        raise ValueError(f"iterations must be a whole number from 0 to {LOWESS_MAX_ITERATIONS}")
    k = max(2, int(frac * n + 1e-10))
    if n < 3 or k > n:
        raise ValueError("LOWESS needs at least 3 finite points")
    if n > LOWESS_MAX_ROWS:
        raise ValueError(f"LOWESS is limited to {LOWESS_MAX_ROWS} rows (got {n}); resample first")
    fx, fy = xv[ok], yv[ok]
    if not _monotonic(fx):
        raise ValueError(
            "LOWESS is refused: X reverses direction (a loop or there-and-back sweep), so each "
            "local fit would average the up and down branches. Split the branches first"
        )
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
    Lorentzian +/-10 FWHM (long tails: that truncation drops about 3% of its area
    before the unit-sum renormalisation)."""
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
    ratio (larger = smoother, less ringing). The record mean is removed before
    and restored after (the DC gain would otherwise be 1/(1+lambda), shrinking a
    baseline), and the record is reflect-padded to suppress wrap-around.
    """
    if not (math.isfinite(regularisation) and regularisation > 0):
        raise ValueError("regularisation must be positive (it keeps the inverse stable)")
    yv = _fill(np.asarray(y, dtype=float).ravel())
    k = kernel_samples(shape, fwhm, require_uniform(x, "deconvolution"))
    half = k.size // 2
    pad = min(2 * half, yv.size - 1)
    mu = float(yv.mean())
    centred = yv - mu
    ext = np.pad(centred, pad, mode="reflect") if pad else centred
    n = sfft.next_fast_len(ext.size + k.size)
    kern = np.zeros(n)
    kern[: k.size] = k
    kern = np.roll(kern, -half)  # centre the kernel on index 0
    big_h = sfft.rfft(kern)
    big_y = sfft.rfft(ext, n)
    est = sfft.irfft(big_y * np.conj(big_h) / (np.abs(big_h) ** 2 + regularisation), n)
    return np.asarray(est[pad : pad + yv.size] + mu, dtype=float)


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
