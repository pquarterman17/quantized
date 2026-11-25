"""Continuous piecewise-linear (segmented) regression (GAP_AUDIT_9 G11).

Pure calc layer. Model, with breakpoints ``psi_1..psi_K`` (1 <= K <= 3):

    y = b0 + b1 x + sum_j c_j (x - psi_j)_+

so the line is continuous and the slope changes by ``c_j`` at ``psi_j``.
Breakpoints are either *fixed* by the user or *estimated* by least squares.

Method (this is NOT Muggeo's (2003) iterative linearisation; it is a plain
profile least squares and is cited to nobody): for given breakpoints the model
is linear in ``(b0, b1, c)``, so the residual sum of squares is a function of
the free breakpoints only. It is minimised by (1) an exhaustive grid of
candidate breakpoints (every ``~n/GRID`` -th sorted x, all ordered tuples), (2)
a bounded ``scipy.optimize.least_squares`` refinement of the best few grid
tuples on the full parameter vector ``(b0, b1, c, psi_free)`` (the Jacobian
column of a breakpoint is ``-c_j * [x > psi_j]``), keeping the lowest RSS.

Standard errors are the Gauss-Newton ``s^2 (J'J)^-1`` of that final fit with
``s^2 = RSS / (n - p)``, ``p = 2 + K + K_free`` -- the same covariance
``scipy.optimize.curve_fit`` reports (the test oracle). A breakpoint SE is
NaN (reported null) when its slope change is ~0 (the breakpoint is not
identified) or the information matrix is singular. Slope SEs are propagated
from the same covariance. The breakpoint SE is a local, asymptotic
approximation; the RSS surface is only piecewise smooth in ``psi``, so treat
it as indicative. Provisional, owner to confirm: grid size, number of refined
starts, the minimum of 2 points per segment, and that nothing is reported
for K > 3.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import least_squares

from quantized.calc.fit_robust import clean_xy

__all__ = ["MAX_BREAKPOINTS", "piecewise_fit"]

MAX_BREAKPOINTS = 3
GRID = 24  # candidate breakpoints per free breakpoint (coarse global search)
REFINE_STARTS = 5
_MIN_SEG = 2  # at least this many points between neighbouring breakpoints / ends

F64 = NDArray[np.float64]


def _design(x: F64, psi: ArrayLike) -> F64:
    cols = [np.ones_like(x), x] + [np.maximum(x - p, 0.0) for p in np.asarray(psi, dtype=float)]
    return np.asarray(np.column_stack(cols), dtype=float)


def _rss_for(x: F64, y: F64, psi: ArrayLike) -> float:
    beta = np.linalg.lstsq(_design(x, psi), y, rcond=None)[0]
    return float(np.sum((y - _design(x, psi) @ beta) ** 2))


def _candidates(x: F64) -> F64:
    ux = np.unique(x)
    inner = ux[_MIN_SEG - 1 : ux.size - (_MIN_SEG - 1)]
    if inner.size == 0:
        raise ValueError("too few distinct x values to place a breakpoint")
    if inner.size > GRID:
        idx = np.unique(np.linspace(0, inner.size - 1, GRID).round().astype(int))
        inner = inner[idx]
    # Midpoints between data keep the start strictly inside the smooth region.
    return np.asarray(inner, dtype=float)


def _full(x: F64, y: F64, fixed: F64, free: Sequence[float]) -> tuple[F64, F64]:
    psi = np.concatenate([fixed, np.asarray(free, dtype=float)])
    beta = np.linalg.lstsq(_design(x, psi), y, rcond=None)[0]
    return np.asarray(beta, dtype=float), psi


def _refine(x: F64, y: F64, fixed: F64, free0: Sequence[float]) -> tuple[float, F64]:
    k_fix, k_free = fixed.size, len(free0)
    beta0, _ = _full(x, y, fixed, free0)
    z0 = np.concatenate([beta0, np.asarray(free0, dtype=float)])
    n_beta = beta0.size
    lo = np.concatenate([np.full(n_beta, -np.inf), np.full(k_free, float(x.min()))])
    hi = np.concatenate([np.full(n_beta, np.inf), np.full(k_free, float(x.max()))])

    def split(z: F64) -> tuple[F64, F64]:
        return z[:n_beta], np.concatenate([fixed, z[n_beta:]])

    def resid(z: F64) -> F64:
        b, psi = split(z)
        return np.asarray(_design(x, psi) @ b - y, dtype=float)

    def jac(z: F64) -> F64:
        b, psi = split(z)
        cols = [_design(x, psi)]
        for j in range(k_fix, k_fix + k_free):
            cols.append((-b[2 + j] * (x > psi[j]))[:, None])
        return np.asarray(np.hstack(cols), dtype=float)

    sol = least_squares(
        resid, np.clip(z0, lo, hi), jac=jac, bounds=(lo, hi), method="trf", x_scale="jac"
    )
    return float(np.sum(sol.fun**2)), np.asarray(sol.x, dtype=float)


def piecewise_fit(
    x: ArrayLike,
    y: ArrayLike,
    n_breakpoints: int = 1,
    fixed_breakpoints: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Fit a continuous piecewise-linear model.

    ``n_breakpoints`` is the TOTAL number of breakpoints (1..3);
    ``fixed_breakpoints`` (optional, inside the x range) are held at their
    values and the remaining ones are estimated. Returns breakpoints sorted by
    position (``value``, ``se``, ``fixed``), the segment ``slopes`` with SEs
    and x extents, the intercept, ``yFit``, ``residuals``, RSS and R^2.
    Fail closed on bad counts, breakpoints outside (min x, max x), too few
    points or an unidentifiable fit.
    """
    xv, yv = clean_xy(x, y)
    if not 1 <= n_breakpoints <= MAX_BREAKPOINTS:
        raise ValueError(f"n_breakpoints must be 1..{MAX_BREAKPOINTS}, got {n_breakpoints}")
    fixed = np.asarray(fixed_breakpoints or [], dtype=float).ravel()
    if fixed.size > n_breakpoints:
        raise ValueError("more fixed breakpoints than n_breakpoints")
    if not np.all(np.isfinite(fixed)) or np.any(fixed <= xv.min()) or np.any(fixed >= xv.max()):
        raise ValueError("fixed breakpoints must be finite and strictly inside the x range")
    k, k_free = int(n_breakpoints), int(n_breakpoints - fixed.size)
    p = 2 + k + k_free
    n = xv.size
    if n <= p:
        raise ValueError(f"need more points than parameters (n={n}, parameters={p})")
    if np.unique(xv).size < p:
        raise ValueError("too few distinct x values for this many breakpoints")

    if k_free == 0:
        beta, psi = _full(xv, yv, fixed, [])
        free_psi: F64 = np.empty(0)
    else:
        cand = _candidates(xv)
        if cand.size < k_free:
            raise ValueError("too few distinct x values to place that many breakpoints")
        scored: list[tuple[float, tuple[float, ...]]] = []
        for combo in itertools.combinations(cand.tolist(), k_free):
            allpsi = np.sort(np.concatenate([fixed, np.asarray(combo)]))
            if np.any(np.diff(allpsi) <= 0):
                continue
            scored.append((_rss_for(xv, yv, np.concatenate([fixed, combo])), combo))
        if not scored:
            raise ValueError("no admissible breakpoint placement on the grid")
        scored.sort(key=lambda t: t[0])
        best: tuple[float, F64] | None = None
        for _, combo in scored[:REFINE_STARTS]:
            cand_fit = _refine(xv, yv, fixed, combo)
            if best is None or cand_fit[0] < best[0]:
                best = cand_fit
        assert best is not None
        z = best[1]
        n_beta = 2 + k
        beta, free_psi = z[:n_beta], z[n_beta:]
        psi = np.concatenate([fixed, free_psi])

    X = _design(xv, psi)
    y_fit = np.asarray(X @ beta, dtype=float)
    resid = yv - y_fit
    rss = float(np.sum(resid**2))
    s2 = rss / (n - p)
    cols = [X]
    for j in range(fixed.size, k):
        cols.append((-beta[2 + j] * (xv > psi[j]))[:, None])
    jac = np.hstack(cols)
    cov = np.full((jac.shape[1], jac.shape[1]), np.nan)
    if np.linalg.matrix_rank(jac) == jac.shape[1]:
        cov = np.linalg.inv(jac.T @ jac) * s2
    se = np.sqrt(np.abs(np.diag(cov)))
    # Order breakpoints by position; carry their slope-change index.
    order = np.argsort(psi)
    bp = [
        {
            "value": float(psi[j]),
            "se": float(se[2 + k + (j - fixed.size)]) if j >= fixed.size else 0.0,
            "fixed": bool(j < fixed.size),
            "slopeChange": float(beta[2 + j]),
        }
        for j in order
    ]
    edges = [float(xv.min())] + [b["value"] for b in bp] + [float(xv.max())]
    slopes = []
    for s in range(k + 1):
        w = np.zeros(cov.shape[0])
        w[1] = 1.0
        for pos in range(s):
            w[2 + int(order[pos])] = 1.0
        slope = float(beta[1] + sum(beta[2 + int(order[pos])] for pos in range(s)))
        var = float(w @ cov @ w)
        slopes.append(
            {
                "slope": slope,
                "se": math.sqrt(var) if var >= 0 else math.nan,
                "xStart": edges[s],
                "xEnd": edges[s + 1],
            }
        )
    tot = float(np.sum((yv - yv.mean()) ** 2))
    return {
        "breakpoints": bp,
        "slopes": slopes,
        "intercept": float(beta[0]),
        "interceptSe": float(se[0]),
        "yFit": y_fit,
        "residuals": resid,
        "rss": rss,
        "rSquared": 1.0 - rss / tot if tot > 0 else math.nan,
        "sigma": math.sqrt(s2),
        "dof": n - p,
        "nPoints": n,
    }
