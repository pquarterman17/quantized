"""York regression: straight line with a separate X and Y error per point.

Pure calc layer. Fits ``y = slope * x + intercept`` to points whose X and Y
each carry their own standard error (``sigma_x[i]``, ``sigma_y[i]``) and an
optional per-point error correlation ``rho[i]`` (default 0). The slope is the
fixed point of York's iteration; intercept and the standard errors follow in
closed form. Unlike the Deming/orthogonal fit in :mod:`quantized.calc.fit_odr`
(one variance ratio taken from the mean errors, jackknife errors) every point
keeps its own weight.

Reference: York, D., Evensen, N. M., Martinez, M. L. and De Basabe Delgado, J.
"Unified equations for the slope, intercept, and standard errors of the best
straight line", Am. J. Phys. 72, 367-375 (2004), Table II (steps 1-11).

``slopeErr`` / ``interceptErr`` are the paper's standard errors (they assume
the stated errors are right). ``mswd`` is the reduced chi-square ``S / (n - 2)``
(Mean Square of Weighted Deviates): about 1 when the errors explain the
scatter; a larger value means extra scatter, and the errors above are then too
small by roughly ``sqrt(mswd)`` (``slopeErrScaled`` / ``interceptErrScaled``).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["york_fit"]

_MAX_ITER = 200
_RTOL = 1e-14


def _positive_finite(name: str, v: NDArray[np.float64], n: int) -> NDArray[np.float64]:
    if v.size != n:
        raise ValueError(f"{name} must have the same length as x")
    if not bool(np.all(np.isfinite(v))) or bool(np.any(v <= 0)):
        raise ValueError(f"{name} entries must be finite and > 0")
    return v


def york_fit(
    x: ArrayLike,
    y: ArrayLike,
    x_error: ArrayLike,
    y_error: ArrayLike,
    *,
    rho: ArrayLike | None = None,
) -> dict[str, Any]:
    """York straight-line fit with per-point X and Y standard errors.

    ``x_error`` / ``y_error`` are 1-sigma errors (> 0, one per point); ``rho``
    the X-Y error correlation of each point in (-1, 1) (default 0). Returns
    ``slope``, ``intercept``, ``slopeErr``, ``interceptErr``, the scaled
    errors, ``chiSq`` (S), ``mswd`` (S / (n - 2)), ``dof``, ``n``, ``nIter``.
    Raises ``ValueError`` on fewer than 3 points, non-finite values or
    non-positive errors.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = xv.size
    if yv.size != n:
        raise ValueError("x and y must have the same length")
    if n < 3:
        raise ValueError(f"York regression requires at least 3 points (got {n})")
    if not (bool(np.all(np.isfinite(xv))) and bool(np.all(np.isfinite(yv)))):
        raise ValueError("x and y must be finite")
    sx = _positive_finite("x_error", np.asarray(x_error, dtype=float).ravel(), n)
    sy = _positive_finite("y_error", np.asarray(y_error, dtype=float).ravel(), n)
    r = np.zeros(n) if rho is None else np.asarray(rho, dtype=float).ravel()
    if r.size != n:
        raise ValueError("rho must have the same length as x")
    if not bool(np.all(np.isfinite(r))) or bool(np.any(np.abs(r) >= 1.0)):
        raise ValueError("rho entries must be finite and strictly between -1 and 1")
    if float(np.ptp(xv)) == 0.0:
        raise ValueError("x values are all equal: the slope is undefined")

    wx = 1.0 / sx**2
    wy = 1.0 / sy**2
    alpha = np.sqrt(wx * wy)

    # Step 1: start from the ordinary least-squares slope.
    xc = xv - float(np.mean(xv))
    b = float(np.sum(xc * (yv - float(np.mean(yv)))) / np.sum(xc**2))

    n_iter = 0
    converged = False
    while n_iter < _MAX_ITER:
        n_iter += 1
        w = wx * wy / (wx + b**2 * wy - 2.0 * b * r * alpha)
        xbar = float(np.sum(w * xv) / np.sum(w))
        ybar = float(np.sum(w * yv) / np.sum(w))
        u = xv - xbar
        v = yv - ybar
        beta = w * (u / wy + b * v / wx - (b * u + v) * r / alpha)
        b_new = float(np.sum(w * beta * v) / np.sum(w * beta * u))
        done = abs(b_new - b) <= _RTOL * max(abs(b_new), 1e-300)
        b = b_new
        if done:
            converged = True
            break
    if not converged or not math.isfinite(b):
        raise ValueError("York iteration did not converge")

    # Recompute the weights at the final slope (steps 3-4, then 9-11).
    w = wx * wy / (wx + b**2 * wy - 2.0 * b * r * alpha)
    xbar = float(np.sum(w * xv) / np.sum(w))
    ybar = float(np.sum(w * yv) / np.sum(w))
    a = ybar - b * xbar
    u = xv - xbar
    v = yv - ybar
    beta = w * (u / wy + b * v / wx - (b * u + v) * r / alpha)
    adj_x = xbar + beta  # adjusted x_i
    xadj_bar = float(np.sum(w * adj_x) / np.sum(w))
    uadj = adj_x - xadj_bar
    var_b = 1.0 / float(np.sum(w * uadj**2))
    var_a = 1.0 / float(np.sum(w)) + xadj_bar**2 * var_b
    chi_sq = float(np.sum(w * (yv - b * xv - a) ** 2))
    dof = n - 2
    mswd = chi_sq / dof
    scale = math.sqrt(mswd)
    return {
        "slope": b,
        "intercept": a,
        "slopeErr": math.sqrt(var_b),
        "interceptErr": math.sqrt(var_a),
        "slopeErrScaled": math.sqrt(var_b) * scale,
        "interceptErrScaled": math.sqrt(var_a) * scale,
        "chiSq": chi_sq,
        "mswd": mswd,
        "dof": dof,
        "n": n,
        "nIter": n_iter,
    }
