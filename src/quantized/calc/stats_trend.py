"""Mann-Kendall trend test with Sen's slope.

A distribution-free test for a monotonic trend in a series ``y`` observed at
ordered times ``x`` (the row order when ``x`` is omitted). Item 8 of the Origin
feature-gap plan. Formulas (Mann 1945; Kendall 1975; Sen 1968; Gilbert 1987,
*Statistical Methods for Environmental Pollution Monitoring*, ch. 16):

* ``S = sum_{i<j} sign(y_j - y_i)`` over the time-ordered series;
* ``Var(S) = [n(n-1)(2n+5) - sum_p t_p (t_p - 1)(2 t_p + 5)] / 18`` where
  ``t_p`` are the sizes of the groups of tied ``y`` values (tie correction);
* ``Z = (S - 1) / sqrt(Var)`` if ``S > 0``, ``(S + 1) / sqrt(Var)`` if
  ``S < 0``, ``0`` if ``S = 0`` (continuity correction), and the two-sided
  ``p = 2 (1 - Phi(|Z|))`` (normal approximation; use it for ``n >= 10`` or so);
* Kendall's ``tau`` is tau-b against time, ``S / sqrt(n0 (n0 - n1))`` with
  ``n0 = n(n-1)/2`` and ``n1 = sum t_p (t_p - 1) / 2`` (the times are distinct),
  the value ``scipy.stats.kendalltau`` returns;
* Sen's slope is the median of the pairwise slopes ``(y_j - y_i)/(x_j - x_i)``
  over ``i < j``; its ``1 - alpha`` interval takes ``C = z_{1-alpha/2}
  sqrt(Var(S))`` and the order statistics of the ``N = n(n-1)/2`` sorted slopes
  at ranks ``(N - C)/2`` and ``(N + C)/2 + 1`` (1-based, linearly interpolated
  between neighbours when fractional, clipped to ``[1, N]``). The intercept is
  ``median(y) - slope * median(x)`` (Conover).

``x`` must be distinct (after dropping non-finite pairs); the series is sorted
by ``x``. A series with no variation at all (every ``y`` tied) has ``Var`` 0
and is refused. Pure numpy / scipy; checked by hand in
``tests/test_calc_stats_trend.py``.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = ["mann_kendall"]

MAX_N = 5000  # N(N-1)/2 pairwise slopes are materialised


def _rank_value(sorted_slopes: NDArray[np.float64], rank: float) -> float:
    """The 1-based fractional order statistic, linearly interpolated, clipped."""
    n = sorted_slopes.size
    r = min(max(rank, 1.0), float(n))
    lo = int(math.floor(r))
    hi = min(lo + 1, n)
    frac = r - lo
    return float(sorted_slopes[lo - 1] * (1.0 - frac) + sorted_slopes[hi - 1] * frac)


def mann_kendall(
    y: Any,
    x: Any | None = None,
    *,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Mann-Kendall test and Sen's slope for ``y`` against ``x`` (default: 0, 1, ...)."""
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    yv = np.asarray(y, dtype=float).ravel()
    if x is None:
        xv = np.arange(yv.size, dtype=float)
    else:
        xv = np.asarray(x, dtype=float).ravel()
        if xv.size != yv.size:
            raise ValueError("x and y must be the same length")
    keep = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[keep], yv[keep]
    n = int(yv.size)
    if n < 3:
        raise ValueError("the Mann-Kendall test needs at least 3 finite observations")
    if n > MAX_N:
        raise ValueError(f"{n} observations; the limit is {MAX_N} (all pairwise slopes are formed)")
    order = np.argsort(xv, kind="stable")
    xv, yv = xv[order], yv[order]
    if np.any(np.diff(xv) <= 0.0):
        raise ValueError("x values must be distinct; the series is ordered by x")

    iu = np.triu_indices(n, k=1)
    dy = yv[iu[1]] - yv[iu[0]]
    s = int(np.sum(np.sign(dy)))
    _, counts = np.unique(yv, return_counts=True)
    t = counts.astype(float)
    tie_term = float(np.sum(t * (t - 1.0) * (2.0 * t + 5.0)))
    var_s = (n * (n - 1.0) * (2.0 * n + 5.0) - tie_term) / 18.0
    if var_s <= 0.0:
        raise ValueError("every value is tied; there is no trend to test")
    sd = math.sqrt(var_s)
    z = 0.0 if s == 0 else (s - 1.0) / sd if s > 0 else (s + 1.0) / sd
    p = float(2.0 * sps.norm.sf(abs(z)))
    n0 = n * (n - 1.0) / 2.0
    n1 = float(np.sum(t * (t - 1.0)) / 2.0)
    tau = s / math.sqrt(n0 * (n0 - n1))

    slopes = np.sort(dy / (xv[iu[1]] - xv[iu[0]]))
    n_slopes = int(slopes.size)
    slope = float(np.median(slopes))
    c = float(sps.norm.isf(alpha / 2.0)) * sd
    lo = _rank_value(slopes, (n_slopes - c) / 2.0)
    hi = _rank_value(slopes, (n_slopes + c) / 2.0 + 1.0)
    intercept = float(np.median(yv) - slope * np.median(xv))
    trend = "no trend" if p >= alpha else ("increasing" if s > 0 else "decreasing")
    return {
        "n": n,
        "S": s,
        "var_S": var_s,
        "Z": float(z),
        "p": p,
        "tau": float(tau),
        "sen_slope": slope,
        "sen_ci_low": lo,
        "sen_ci_high": hi,
        "sen_intercept": intercept,
        "n_tie_groups": int(np.sum(counts > 1)),
        "alpha": float(alpha),
        "significant": bool(p < alpha),
        "trend": trend,
        "method": "Mann-Kendall trend test with Sen's slope",
    }
