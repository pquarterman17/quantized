"""Fit a registry model convolved with an instrument function (GAP_AUDIT_9 G11).

Pure calc layer. The fitted curve is ``(f(.; p) * K)(x)``, the model ``f``
convolved with a unit-area kernel ``K``:

* ``gaussian``  -- Gaussian of standard deviation ``sigma`` (the instrument
  width), either held fixed or fitted as one extra trailing parameter;
* ``measured``  -- a user-supplied resolution profile sampled on the data x
  (one value per point, same ``x``), normalised to unit area and re-centred
  on its centroid so the convolution broadens without shifting the peak.

Numerics: the model is evaluated on a uniform grid covering
``[min x - h, max x + h]`` (``h`` = the kernel half-width, ``5 sigma`` for the
Gaussian; the measured profile's own extent), with step
``min(median dx / OVERSAMPLE, sigma / 8)`` for the Gaussian (and the data grid
spacing / OVERSAMPLE for a measured kernel), convolved by FFT (``mode="same"``)
and linearly interpolated back to the data x. The model must therefore be
defined (finite) slightly outside the data range; a non-finite value refuses.
Because the kernel has unit area, a peak model's amplitude parameter is the
amplitude of the UNBROADENED peak times the area factor, not the observed height;
read widths from the fitted parameters (for a Gaussian peak the observed width
is ``sqrt(sigma_model^2 + sigma_instr^2)``).

Parameter errors: Gauss-Newton ``s^2 (J'J)^-1`` from ``least_squares``, as the
other fits. A Gaussian instrument width cannot be separated from a model
width that is also free (they are degenerate); fit the instrument width only
when the model has no free width of its own, otherwise hold it. Provisional,
owner to confirm: kernel truncation at 5 sigma, grid oversampling 8.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import least_squares
from scipy.signal import fftconvolve

from quantized.calc.fit_robust import clean_xy

__all__ = ["convolution_fit", "convolve_model"]

OVERSAMPLE = 8
KERNEL_SIGMAS = 5.0
MAX_GRID = 400_000

F64 = NDArray[np.float64]
ModelFn = Callable[[F64, F64], F64]


def _norm_kernel(k: F64) -> F64:
    area = float(k.sum())
    if not area > 0:
        raise ValueError("instrument function has no positive area")
    return np.asarray(k / area, dtype=float)


def _measured_kernel(x: F64, res: F64, step: float) -> tuple[F64, int]:
    """Resolution profile on a uniform grid of ``step``, centred on its centroid.

    Returns (kernel, index of the centroid sample)."""
    if res.size != x.size:
        raise ValueError("resolution must have one value per data point")
    if not np.all(np.isfinite(res)):
        raise ValueError("resolution must be finite")
    order = np.argsort(x)
    xs, rs = x[order], res[order]
    if np.any(np.diff(xs) <= 0):
        raise ValueError("x must be strictly increasing (distinct) to use a measured resolution")
    if rs.min() < -0.05 * rs.max():
        raise ValueError("resolution has large negative values; it must be a non-negative profile")
    rs = np.clip(rs, 0.0, None)
    if not rs.sum() > 0:
        raise ValueError("resolution is zero everywhere")
    centroid = float(np.trapezoid(rs * xs, xs) / np.trapezoid(rs, xs))
    grid = np.arange(xs[0] - centroid, xs[-1] - centroid + step / 2, step)
    k = np.interp(grid, xs - centroid, rs, left=0.0, right=0.0)
    ic = int(round(-grid[0] / step))
    return _norm_kernel(k), ic


def convolve_model(
    model_fcn: ModelFn,
    x: ArrayLike,
    p: ArrayLike,
    *,
    sigma: float | None = None,
    resolution: ArrayLike | None = None,
) -> F64:
    """``(model * kernel)`` at ``x``; exactly one of ``sigma`` / ``resolution``."""
    xv = np.asarray(x, dtype=float).ravel()
    pv = np.asarray(p, dtype=float)
    if (sigma is None) == (resolution is None):
        raise ValueError("give exactly one of sigma (Gaussian) or resolution (measured)")
    dx = np.diff(np.unique(xv))
    if dx.size == 0:
        raise ValueError("need at least two distinct x values")
    step = float(np.median(dx)) / OVERSAMPLE
    if sigma is not None:
        if not (math.isfinite(sigma) and sigma > 0):
            raise ValueError("instrument sigma must be a positive finite number")
        step = min(step, sigma / 8.0)
        half = KERNEL_SIGMAS * sigma
        n_half = int(math.ceil(half / step))
        kx = step * np.arange(-n_half, n_half + 1)  # odd length: centred on index n_half
        kernel = _norm_kernel(np.exp(-0.5 * (kx / sigma) ** 2))
        ic = n_half
    else:
        kernel, ic = _measured_kernel(xv, np.asarray(resolution, dtype=float).ravel(), step)
    pad_lo, pad_hi = ic * step, (kernel.size - 1 - ic) * step
    lo, hi = float(xv.min()) - pad_hi, float(xv.max()) + pad_lo
    m = int(math.ceil((hi - lo) / step)) + 1
    if m > MAX_GRID:
        raise ValueError("convolution grid too large (instrument width tiny against the x range)")
    g: F64 = lo + step * np.arange(m, dtype=np.float64)
    f = np.asarray(model_fcn(g, pv), dtype=float)
    if not np.all(np.isfinite(f)):
        raise ValueError("model is not finite on the padded convolution grid")
    # Output sample i is sum_j f[i - j] K[j]; with the centroid at index ic the
    # kernel is centred, so "same" mode alignment needs a shift of ic - size//2.
    full = fftconvolve(f, kernel, mode="full")
    conv = full[ic : ic + m]
    return np.asarray(np.interp(xv, g, conv), dtype=float)


def convolution_fit(
    x: ArrayLike,
    y: ArrayLike,
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    sigma: float | None = None,
    fit_sigma: bool = False,
    resolution: ArrayLike | None = None,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    weights: ArrayLike | None = None,
) -> dict[str, Any]:
    """Least-squares fit of ``model * instrument`` to (x, y).

    Gaussian instrument: ``sigma`` is held (``fit_sigma=False``) or is the
    start value of a fitted trailing parameter (``fit_sigma=True``). A measured
    ``resolution`` (one value per x) is always held. Response ``params`` =
    model parameters (+ ``sigma`` last when fitted), ``instrumentSigma`` the
    width used.
    """
    xv, yv = clean_xy(x, y)
    if resolution is not None and (sigma is not None or fit_sigma):
        raise ValueError("a measured resolution cannot be combined with a Gaussian sigma")
    if resolution is None and sigma is None:
        raise ValueError("give a Gaussian sigma or a measured resolution")
    if resolution is not None and not np.all(np.isfinite(np.asarray(resolution, dtype=float))):
        raise ValueError("resolution must be finite")
    m = len(p0)
    n_par = m + (1 if fit_sigma else 0)
    if xv.size <= n_par:
        raise ValueError(f"need more points than parameters (n={xv.size}, params={n_par})")
    w = np.ones(xv.size) if weights is None else np.asarray(weights, dtype=float).ravel()
    if w.size != xv.size or not np.all(np.isfinite(w)) or np.any(w < 0) or not np.any(w > 0):
        raise ValueError("weights must have one finite entry >= 0 per point, not all zero")
    sw = np.sqrt(w)
    lb = np.full(m, -np.inf) if lower is None else np.asarray(lower, dtype=float)
    ub = np.full(m, np.inf) if upper is None else np.asarray(upper, dtype=float)
    if lb.size != m or ub.size != m or np.any(lb >= ub):
        raise ValueError("bounds must be one (lower < upper) pair per parameter")
    if fit_sigma:
        lb, ub = np.append(lb, 1e-12), np.append(ub, np.inf)
    start = np.asarray(p0, dtype=float)
    if fit_sigma:
        start = np.append(start, float(sigma) if sigma is not None else math.nan)
        if not math.isfinite(start[-1]):
            raise ValueError("fitting the instrument width needs a Gaussian start value for sigma")
    start = np.clip(start, lb + 1e-12, ub)

    def curve(z: F64) -> F64:
        if resolution is not None:
            return convolve_model(model_fcn, xv, z[:m], resolution=resolution)
        s = float(z[m]) if fit_sigma else float(sigma)  # type: ignore[arg-type]
        return convolve_model(model_fcn, xv, z[:m], sigma=s)

    sol = least_squares(
        lambda z: sw * (curve(z) - yv),
        start,
        bounds=(lb, ub),
        method="trf",
        x_scale="jac",
        xtol=1e-12,
        ftol=1e-12,
        gtol=1e-12,
    )
    z = np.asarray(sol.x, dtype=float)
    yfit = curve(z)
    rss = float(np.sum(w * (yv - yfit) ** 2))
    s2 = rss / max(xv.size - n_par, 1)
    errs: F64 = np.full(n_par, np.nan)
    try:
        errs = np.asarray(
            np.sqrt(np.abs(np.diag(np.linalg.inv(sol.jac.T @ sol.jac))) * s2), dtype=float
        )
    except np.linalg.LinAlgError:
        pass
    tot = float(np.sum((yv - yv.mean()) ** 2))
    return {
        "params": z,
        "errors": errs,
        "fitSigma": bool(fit_sigma),
        "instrumentSigma": float(z[m])
        if fit_sigma
        else (float(sigma) if sigma is not None else None),
        "yFit": yfit,
        "residuals": yv - yfit,
        "rss": rss,
        "rSquared": 1.0 - float(np.sum((yv - yfit) ** 2)) / tot if tot > 0 else math.nan,
        "nPoints": int(xv.size),
        "success": bool(sol.success),
        "message": str(sol.message),
    }
