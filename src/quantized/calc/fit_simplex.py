"""Nelder-Mead start-up and stall checks for the bound-transformed fitters.

Pure calc layer, shared by ``calc.fitting.curve_fit`` and
``calc.global_curve_fit``.

Why an explicit initial simplex: both fitters optimise in a *free* space where
a one-sided bound maps ``p -> log(p - lo + eps)`` and a two-sided bound maps
``p -> logit``. A start exactly one unit above a lower bound (``p0 = lo + 1``,
e.g. a width of 1 with ``lo = 0``) lands at ``log(1 + eps) ~ 2.2e-16``, and the
default Nelder-Mead simplex (scipy and MATLAB ``fminsearch`` alike) steps each
non-zero coordinate by 5 % of itself -- ``1e-17`` here. The simplex never
leaves the start and the fit "converges" with that parameter frozen (fitting
audit, finding 2). ``initial_simplex`` reproduces the default rule exactly for
every other coordinate (so MATLAB golden parity is untouched) and gives a
near-zero *transformed* coordinate an absolute step instead.

``stalled_parameters`` is the independent safety net: a parameter reported at
its exact start while a small in-bounds move of it still lowers the cost was
never optimised -- the caller must not report success. ``nudge_inside`` keeps
a start that sits ON a bound from freezing there in the first place.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np
from numpy.typing import NDArray

__all__ = ["function_tolerance", "initial_simplex", "nudge_inside", "stalled_parameters"]

# scipy ``_minimize_neldermead`` / MATLAB ``fminsearch`` defaults.
_NONZDELT = 0.05
_ZDELT = 0.00025
# A transformed coordinate this close to zero is treated as "zero-scaled":
# 5 % of it would be a sub-1e-7 step in log/logit space. 0.05 there moves the
# bounded parameter by ~5 % of its distance to the bound (log) or ~1 % of the
# bound interval (logit at the midpoint) -- a sensible first probe.
_NEAR_ZERO = 1e-6
_TRANSFORMED_STEP = 0.05


def initial_simplex(x0: NDArray[np.float64], transformed: Sequence[bool]) -> NDArray[np.float64]:
    """Nelder-Mead starting simplex, shape ``(n + 1, n)``.

    Identical to scipy's default (``x * 1.05`` for non-zero coordinates,
    ``0.00025`` for exact zeros) except that a *transformed* coordinate with
    ``|x| < 1e-6`` steps by an absolute ``0.05``.
    """
    x = np.asarray(x0, dtype=float).ravel()
    n = x.size
    sim = np.empty((n + 1, n), dtype=float)
    sim[0] = x
    for k in range(n):
        y = np.array(x, copy=True)
        if transformed[k] and abs(y[k]) < _NEAR_ZERO:
            y[k] = y[k] + _TRANSFORMED_STEP
        elif y[k] != 0:
            y[k] = (1 + _NONZDELT) * y[k]
        else:
            y[k] = _ZDELT
        sim[k + 1] = y
    return sim


def function_tolerance(tol_fun: float, cost0: float) -> float:
    """Nelder-Mead ``fatol`` with MATLAB ``fminsearch``'s floor.

    fminsearch stops on ``max|f - f_best| <= max(TolFun, 10*eps(f_best))``;
    scipy's ``fatol`` is purely absolute. With a large cost (thousands of
    counts squared) ``1e-12`` is below the float spacing of the cost itself,
    so the test can never pass: the simplex collapses in x and then burns the
    whole evaluation budget, and a good fit comes back ``exitFlag`` 0. The
    floor is evaluated at the START cost (scipy exposes no hook on the
    current best); that is safe because scipy also requires the simplex to
    have collapsed to ``xatol`` in x, so a loose ``fatol`` alone never stops a
    fit early. Nelder-Mead's path is unchanged -- only its stopping test.
    """
    if not np.isfinite(cost0):
        return tol_fun
    return max(tol_fun, 10 * float(np.spacing(abs(cost0))))


def nudge_inside(
    p0: NDArray[np.float64],
    lower: NDArray[np.float64],
    upper: NDArray[np.float64],
    free_idx: Sequence[int],
) -> NDArray[np.float64]:
    """Move free starts that sit ON (or within a hair of) a bound just inside.

    A start exactly on a bound maps to ``-+log(eps) ~ -+36`` in the free
    space, where the transform is flat to ~1e-16: the simplex cannot feel the
    cost and the parameter never leaves the bound, yet Nelder-Mead reports
    success (review item 3: an offset started on its upper bound stayed there
    with R² = -2.7 and exitFlag 1). The start is moved in by 0.1 % of the
    bound interval (two-sided) or of ``max(|bound|, 1)`` (one-sided), which
    is ~-7 in the free space -- an ordinary coordinate. Starts already
    further in than that are untouched, so nothing else changes.
    """
    out = np.asarray(p0, dtype=float).copy()
    for k in free_idx:
        lo, hi = float(lower[k]), float(upper[k])
        if np.isfinite(lo) and np.isfinite(hi):
            if hi <= lo:
                continue
            step = 1e-3 * (hi - lo)
        else:
            step = 1e-3 * max(abs(lo) if np.isfinite(lo) else abs(hi), 1.0)
        if np.isfinite(lo) and out[k] - lo < step:
            out[k] = lo + step
        elif np.isfinite(hi) and hi - out[k] < step:
            out[k] = hi - step
    return out


def stalled_parameters(
    cost: Callable[[NDArray[np.float64]], float],
    p_opt: NDArray[np.float64],
    p_start: NDArray[np.float64],
    lower: NDArray[np.float64],
    upper: NDArray[np.float64],
    free_idx: Sequence[int],
) -> list[int]:
    """Indices of free parameters that never left their start although the
    cost still falls along them.

    ``cost`` takes the full *bounded* parameter vector. A parameter counts as
    stalled when (a) it equals its start to 1e-12 relative and (b) moving it
    by 0.1 % (of ``max(|p|, 1)``, either way, clipped into its bounds)
    actually LOWERS the cost by more than 1e-6 relative. Comparing real
    costs, not a finite-difference slope, keeps a perfect fit (cost ~1e-25,
    all round-off) from looking stalled: at a true optimum both moves raise
    the cost. A parameter on a bound gets no exemption -- the clipping is the
    test: on a genuinely active bound the outward move is clipped away and
    the inward one raises the cost, while a parameter merely frozen on its
    bound is caught by the inward move lowering it.
    """
    c0 = float(cost(p_opt))
    if not np.isfinite(c0) or c0 <= 0:
        return []
    out: list[int] = []
    for k in free_idx:
        pk, p0k = float(p_opt[k]), float(p_start[k])
        scale = max(abs(pk), 1.0)
        if abs(pk - p0k) > 1e-12 * max(abs(p0k), 1.0):
            continue
        best = c0
        for step in (1e-3 * scale, -1e-3 * scale):
            moved = p_opt.copy()
            moved[k] = min(max(pk + step, lower[k]), upper[k])
            if moved[k] == pk:
                continue
            val = float(cost(moved))
            if np.isfinite(val):
                best = min(best, val)
        if best < c0 * (1 - 1e-6):
            out.append(int(k))
    return out
