"""Polynomial regression bands: confidence (mean-response) and prediction.

Split out of ``calc.stats`` (JMP_GAP_PLAN J3 residual: extending the
confidence band with a prediction-band option pushed ``stats.py`` over the
500-line god-module ceiling) -- mirrors how ``stats_anova2``/``stats_varcomp``
already import shared helpers (``_f_cdf``) from ``calc.stats`` rather than
duplicating them. Pure: ndarrays in, a plain result dict out. No FastAPI
imports.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats import _t_inv

__all__ = ["polynomial_confidence_band"]

_BAND_INTERVALS = ("confidence", "prediction")


def polynomial_confidence_band(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    x_grid: NDArray[np.float64],
    *,
    order: int = 1,
    alpha: float = 0.05,
    interval: str = "confidence",
) -> dict[str, Any]:
    """Standard OLS mean-response confidence band -- or, with
    ``interval="prediction"``, a new-observation prediction band -- for a
    polynomial fit (JMP_GAP_PLAN J3 residual -- Fit Y by X's bivariate leg).

    Refits the SAME order-``order`` least-squares polynomial ``lin_regress``
    computes (the normal-equations solve is duplicated here rather than
    exported from ``lin_regress``, so ``/api/stats/regression``'s existing
    response stays byte-identical for callers that don't ask for a band) and
    evaluates the textbook band at each ``x_grid`` point::

        yFit(x0) +/- t(1 - alpha/2, df) * sqrt(mse * v(x0))

    where ``v(x0) = x0 @ inv(X'X) @ x0'`` for the CONFIDENCE (mean-response)
    band, and ``v(x0) = 1 + x0 @ inv(X'X) @ x0'`` for the PREDICTION band --
    the standard "+1" that accounts for a single new observation's own
    residual variance on top of the fitted mean's uncertainty (e.g. Draper &
    Smith, *Applied Regression Analysis*, 3rd ed., ch. 2; Montgomery,
    Peck & Vining, *Introduction to Linear Regression Analysis*, ch. 3).
    A prediction band is always wider than the confidence band at the same
    ``x0`` and alpha, which the reference-value test below pins directly.

    Not ``calc.fit_stats.fit_bands``: that module's numerical-Jacobian
    machinery (+ its heuristic prediction-band variance, ``s2 =
    sum(var_ci)/trace(J'J)``) is built for a NONLINEAR curve fit that hands
    over only a fitted covariance matrix, no raw (x, y) or residuals. A
    polynomial's design matrix is exact and already recomputable here, so
    the closed-form band below is both simpler and exact (the mean-CI
    variance ``fit_bands`` would derive via its numerical Jacobian is
    identical in the polynomial case -- the model is linear in its
    parameters -- but its prediction-band ``s2`` is a different, non-exact
    quantity this function doesn't need). See ``lin_regress``'s own
    docstring for the historical MATLAB ``confBand``/``predBand`` note this
    finally implements both halves of.
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")
    if interval not in _BAND_INTERVALS:
        raise ValueError(f"interval must be one of {_BAND_INTERVALS}, got {interval!r}")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must have the same length (got {xv.size} vs {yv.size})")
    n = xv.size
    k = order + 1
    if n < k + 1:
        raise ValueError(f"need at least {k + 1} points for order-{order} regression")

    xmat = np.vander(xv, k, increasing=True)
    xtx = xmat.T @ xmat
    try:
        coeffs = np.linalg.solve(xtx, xmat.T @ yv)
        xtx_inv = np.linalg.inv(xtx)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            f"order-{order} regression is singular -- x has too few distinct values "
            f"or is collinear; use a lower order or more varied x"
        ) from exc
    residuals = yv - xmat @ coeffs
    df = n - k
    mse = float(np.sum(residuals**2)) / df

    xg = np.asarray(x_grid, dtype=float).ravel()
    grid_mat = np.vander(xg, k, increasing=True)
    y_fit = grid_mat @ coeffs
    leverage = np.maximum(np.einsum("ij,jk,ik->i", grid_mat, xtx_inv, grid_mat), 0.0)
    if interval == "prediction":
        leverage = leverage + 1.0
    var_band = mse * leverage
    t_crit = _t_inv(1.0 - alpha / 2.0, df)
    half_width = t_crit * np.sqrt(var_band)

    return {
        "x": xg,
        "yFit": y_fit,
        "ciLo": y_fit - half_width,
        "ciHi": y_fit + half_width,
        "alpha": alpha,
        "interval": interval,
    }
