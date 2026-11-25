"""First-order (linear) propagation of per-point M uncertainty.

Used by the isotherm analyses (Maxwell entropy change, Arrott intercept / Tc).
Every formula here is the Jacobian of a quantity that is a smooth function of
the measured M values, applied as ``var = sum_i (dQ/dM_i)^2 sigma_i^2``.
Assumptions, stated in the results: the M points are independent (no
correlated drift), the uncertainty is 1-sigma, and field and temperature are
exact.  A first-order result is exact for a linear quantity (dS) and an
approximation for the Arrott intercept (a nonlinear function of M).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

#: Shown with every propagated +/- (the UI repeats it).
FIRST_ORDER_NOTE = (
    "first-order (linear) propagation of the per-point M uncertainty, points "
    "independent; field and temperature treated as exact"
)


def trapezoid_weights(h: NDArray[np.float64], grid: NDArray[np.float64]) -> NDArray[np.float64]:
    """Weights ``v`` with ``v @ M == trapezoid(interp(grid, h, M), grid)`` for any M.

    ``h`` ascending and spanning ``grid`` (checked by the caller).
    """
    c = np.full(grid.size, float(grid[1] - grid[0]))
    c[0] = c[-1] = c[0] / 2.0
    idx = np.clip(np.searchsorted(h, grid, side="right") - 1, 0, h.size - 2)
    t = (grid - h[idx]) / (h[idx + 1] - h[idx])
    v = np.zeros(h.size)
    np.add.at(v, idx, c * (1.0 - t))
    np.add.at(v, idx + 1, c * t)
    return v


def ols_intercept_gradients(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """(da/dx_i, da/dy_i) of the OLS intercept ``a = ybar - b xbar`` of y on x."""
    n = x.size
    xm, ym = float(x.mean()), float(y.mean())
    sxx = float(np.sum((x - xm) ** 2))
    b = float(np.sum((x - xm) * (y - ym)) / sxx)
    da_dy = 1.0 / n - xm * (x - xm) / sxx
    db_dx = ((y - ym) - 2.0 * b * (x - xm)) / sxx
    da_dx = -b / n - xm * db_dx
    return da_dx, da_dy
