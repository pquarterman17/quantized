"""Shared machinery for data-driven initial guesses (Origin built-in models).

Pure calc layer. Most Origin built-ins are *separable*: for fixed values of a
few nonlinear parameters (centre, width, time constant, ...) the model is
linear in the rest (offset ``y0``, amplitude/area ``A``, asymptotes ``A1/A2``).
:func:`varpro` exploits that — the classic variable-projection idea (Golub &
Pereyra, SIAM J. Numer. Anal. 10, 413 (1973)): scan a coarse grid of the
nonlinear parameters, solve the linear ones exactly by least squares at each
grid point, keep the best, then polish the nonlinear ones with a short
Nelder-Mead. The result is a guess that already sits in the right basin, which
is what the bounded Nelder-Mead engine in ``calc.fitting`` needs to converge.

The guess runs on at most :data:`MAX_GUESS_POINTS` x-sorted points (an even
subsample) so it stays cheap on 10k-point scans; the real fit uses every point.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

__all__ = [
    "MAX_GUESS_POINTS",
    "Design",
    "PeakEstimate",
    "geomspace_around",
    "peak_estimate",
    "prepare",
    "varpro",
]

MAX_GUESS_POINTS = 1000
_EPS = float(np.finfo(float).eps)

FloatArray = NDArray[np.float64]
# theta (free nonlinear parameters) -> design matrix (n, k), or None if the
# point is outside the model's domain.
Design = Callable[[FloatArray], FloatArray | None]


def prepare(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Finite, x-sorted, evenly subsampled (<= MAX_GUESS_POINTS) copies of x, y."""
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    ok = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[ok], yv[ok]
    order = np.argsort(xv, kind="stable")
    xv, yv = xv[order], yv[order]
    if xv.size > MAX_GUESS_POINTS:
        idx = np.unique(np.linspace(0, xv.size - 1, MAX_GUESS_POINTS).round().astype(int))
        xv, yv = xv[idx], yv[idx]
    return np.asarray(xv, dtype=float), np.asarray(yv, dtype=float)


def _linear_solve(a: FloatArray, y: FloatArray) -> tuple[FloatArray, float]:
    sol, *_ = np.linalg.lstsq(a, y, rcond=None)
    coef = np.asarray(sol, dtype=float)
    resid = np.asarray(y - a @ coef, dtype=float)
    return coef, float(np.sum(resid**2))


def _ssr(design: Design, theta: FloatArray, y: FloatArray) -> tuple[FloatArray | None, float]:
    with np.errstate(all="ignore"):
        try:
            a = design(theta)
        except (OverflowError, ZeroDivisionError, ValueError):  # math.exp/log at a far theta
            return None, math.inf
        if a is None or not np.all(np.isfinite(a)):
            return None, math.inf
        try:
            coef, ssr = _linear_solve(a, y)
        except np.linalg.LinAlgError:
            return None, math.inf
    return (coef, ssr) if math.isfinite(ssr) else (None, math.inf)


def _initial_simplex(theta: FloatArray, points: FloatArray) -> FloatArray:
    """NM start simplex with per-coordinate steps from the grid's own spacing.

    scipy's default steps a zero coordinate by only 2.5e-4, which strands a
    centre that happens to start at x = 0 (a grid quantile of symmetric data).
    """
    steps = np.empty(theta.size)
    for i in range(theta.size):
        vals = np.unique(points[:, i])
        if vals.size > 1:
            steps[i] = float(np.min(np.diff(vals)))
        else:
            steps[i] = 0.05 * abs(float(theta[i])) or 0.1
    simplex = np.tile(theta, (theta.size + 1, 1))
    for i in range(theta.size):
        simplex[i + 1, i] += steps[i]
    return np.asarray(simplex, dtype=float)


def varpro(
    design: Design,
    y: FloatArray,
    grid: Iterable[Sequence[float]],
    *,
    refine: bool = True,
    max_iter: int = 400,
    accept: Callable[[FloatArray], bool] | None = None,
) -> tuple[FloatArray, FloatArray] | None:
    """Best ``(theta, linear_coefs)`` over ``grid``, optionally NM-polished.

    ``accept(coefs)`` may veto a solution (scored as +inf), e.g. a pseudo-Voigt
    whose Lorentzian and Gaussian areas have opposite signs. Returns None when
    no grid point gives an acceptable finite fit (e.g. every candidate lies
    outside the model's domain), so callers can fall back to defaults.
    """

    def score(theta: FloatArray) -> tuple[FloatArray | None, float]:
        coef, ssr = _ssr(design, theta, y)
        if coef is None or (accept is not None and not accept(coef)):
            return None, math.inf
        return coef, ssr

    points = np.asarray([np.asarray(c, dtype=float) for c in grid], dtype=float)
    best_theta: FloatArray | None = None
    best_coef: FloatArray | None = None
    best = math.inf
    for theta in points:
        coef, ssr = score(theta)
        if coef is not None and ssr < best:
            best, best_theta, best_coef = ssr, theta, coef
    if best_theta is None or best_coef is None:
        return None
    if refine and best_theta.size:
        res = minimize(
            lambda t: score(np.asarray(t, dtype=float))[1],
            best_theta, method="Nelder-Mead",
            options={"maxiter": max_iter, "xatol": 1e-10, "fatol": 1e-14 * max(best, _EPS),
                     "initial_simplex": _initial_simplex(best_theta, points)},
        )
        theta = np.asarray(res.x, dtype=float)
        coef, ssr = score(theta)
        if coef is not None and ssr <= best:
            best_theta, best_coef = theta, coef
    return best_theta, best_coef


def geomspace_around(centre: float, factor: float, num: int) -> FloatArray:
    """``num`` log-spaced values from ``centre/factor`` to ``centre*factor``."""
    c = max(abs(centre), _EPS)
    return np.asarray(np.geomspace(c / factor, c * factor, num), dtype=float)


class PeakEstimate:
    """Coarse single-peak descriptors from x-sorted data.

    ``height`` is the signed excursion from the edge baseline (negative for a
    dip); ``fwhm`` comes from the half-maximum
    crossings walked outward from the extremum on a lightly smoothed copy.
    """

    def __init__(self, xc: float, fwhm: float, height: float, baseline: float,
                 left: float, right: float) -> None:
        self.xc, self.fwhm, self.height, self.baseline = xc, fwhm, height, baseline
        self.left, self.right = left, right  # half-max crossing x positions


def _smooth(y: FloatArray) -> FloatArray:
    win = max(1, y.size // 50)
    if win < 2:
        return y
    kernel = np.ones(win) / win
    pad = np.pad(y, (win // 2, win - 1 - win // 2), mode="edge")
    return np.asarray(np.convolve(pad, kernel, mode="valid"), dtype=float)


def peak_estimate(x: FloatArray, y: FloatArray) -> PeakEstimate:
    """Locate the dominant peak (or dip) of x-sorted data. Needs >= 3 points."""
    ys = _smooth(y)
    tail = max(1, x.size // 10)
    baseline = float(np.median(np.concatenate([ys[:tail], ys[-tail:]])))
    dev = ys - baseline
    sign = 1.0 if dev.max() >= -dev.min() else -1.0
    pk = int(np.argmax(sign * dev))
    height = float(dev[pk])
    half = abs(height) / 2
    i = pk
    while i > 0 and sign * dev[i] > half:
        i -= 1
    j = pk
    while j < x.size - 1 and sign * dev[j] > half:
        j += 1
    left = _cross(x, sign * dev, i, i + 1, half) if i < pk else float(x[0])
    right = _cross(x, sign * dev, j - 1, j, half) if j > pk else float(x[-1])
    span = float(x[-1] - x[0])
    fwhm = right - left
    if not math.isfinite(fwhm) or fwhm <= 0:
        fwhm = span / 10 if span > 0 else 1.0
    return PeakEstimate(float(x[pk]), fwhm, height, baseline, left, right)


def _cross(x: FloatArray, d: FloatArray, a: int, b: int, level: float) -> float:
    """Linear interpolation of where d crosses ``level`` between indices a, b."""
    da, db = float(d[a]), float(d[b])
    if da == db:
        return float(x[a])
    t = (level - da) / (db - da)
    return float(x[a] + t * (x[b] - x[a]))
