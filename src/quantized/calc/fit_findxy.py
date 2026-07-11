"""Inverse-evaluate a fitted curve: X -> Y, and Y -> X (ALL crossings). MAIN #15.

Pure calc layer. ``find_y`` is a direct model evaluation at one point.
``find_x`` samples ``model_fcn(x, params)`` on a dense grid over
``[x_min, x_max]``, brackets every sign change (or exact zero) of
``y(x) - target``, and refines each bracket with ``scipy.optimize.brentq`` --
so a non-monotonic curve (e.g. a Gaussian) reports every crossing, not just
the first. ``model_fcn`` is a plain ``fcn(x, p) -> y`` callable, the same
shape used by both ``calc.fit_models.evaluate`` (registry models) and
``calc.fit_equation.equation_model`` (saved custom equations) -- so this
module works identically for either, and the route layer only has to pick
which one produced the callable.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import brentq

__all__ = ["ModelFn", "find_x", "find_y"]

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def find_y(fcn: ModelFn, params: Sequence[float], x: float) -> float:
    """Evaluate the fitted model at a single x."""
    p = np.asarray(params, dtype=float)
    y = fcn(np.asarray([x], dtype=float), p)
    return float(np.asarray(y, dtype=float).ravel()[0])


def find_x(
    fcn: ModelFn,
    params: Sequence[float],
    target: float,
    x_min: float,
    x_max: float,
    *,
    grid_points: int = 2000,
) -> list[float]:
    """All x in [x_min, x_max] where ``fcn(x, params) == target``.

    Returns crossings in ascending order; an empty list (not an error) when
    the curve never reaches ``target`` over the range -- e.g. a monotonic
    curve entirely above or below it.
    """
    if x_max <= x_min:
        raise ValueError("x_max must be greater than x_min")
    if grid_points < 2:
        raise ValueError("grid_points must be at least 2")
    p = np.asarray(params, dtype=float)
    xs = np.linspace(x_min, x_max, grid_points)
    ys = np.asarray(fcn(xs, p), dtype=float).ravel()
    g = ys - target

    def g_at(xv: float) -> float:
        yv = fcn(np.asarray([xv], dtype=float), p)
        return float(np.asarray(yv, dtype=float).ravel()[0]) - target

    # Grid spacing sets the merge tolerance below: a root that lands exactly
    # on a grid node is found once via the `g0 == 0` branch, so the following
    # bracket (whose left endpoint is that same node) must not re-report it.
    dx_tol = (x_max - x_min) / (grid_points - 1) * 1e-6
    roots: list[float] = []
    for i in range(grid_points - 1):
        g0, g1 = float(g[i]), float(g[i + 1])
        if not (np.isfinite(g0) and np.isfinite(g1)):
            continue  # degenerate model params (e.g. div-by-zero) -- skip
        if g0 == 0.0:
            if not roots or xs[i] - roots[-1] > dx_tol:
                roots.append(float(xs[i]))
            continue
        if g0 * g1 < 0.0:
            roots.append(brentq(g_at, float(xs[i]), float(xs[i + 1])))
    if np.isfinite(g[-1]) and g[-1] == 0.0 and (not roots or xs[-1] - roots[-1] > dx_tol):
        roots.append(float(xs[-1]))
    return roots
