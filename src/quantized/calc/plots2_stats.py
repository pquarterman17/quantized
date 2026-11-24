"""Numerics behind the GAP_AUDIT_9 G15 plot types (the ``plots2`` figures).

Pure layer (numpy / scipy only, no matplotlib): the drawing lives in
``figure_parallel`` / ``figure_density2d`` / ``figure_agreement``; this module
holds what must be testable against references.

* :func:`bland_altman` -- Bland-Altman agreement statistics: bias, limits of
  agreement ``bias +/- k*SD`` (``k = 1.96``) and the confidence intervals of
  the bias and of both limits.
  Bland JM, Altman DG (1986) "Statistical methods for assessing agreement
  between two methods of clinical measurement", Lancet 327:307-310,
  doi:10.1016/S0140-6736(86)90837-8;
  Bland JM, Altman DG (1999) "Measuring agreement in method comparison
  studies", Stat Methods Med Res 8:135-160, doi:10.1177/096228029900800204.
  Var(bias) = s^2/n; Var(limit) = s^2/n + k^2 s^2 / (2 (n - 1)) (1999 §3.2,
  which the 1986 paper simplifies to ~3 s^2/n at k = 1.96); each interval is
  ``estimate +/- t(1 - alpha/2, n - 1) * SE``. **Provisional, owner to
  confirm:** the 1999 variance (not the 1986 ``sqrt(3/n)`` shortcut) is used;
  percent differences divide by the pair mean.
* :func:`pareto_table` -- categories summed, sorted descending, cumulative %.
* :func:`kde2d_grid` -- ``scipy.stats.gaussian_kde`` on a grid; bandwidth is
  Scott's rule by default (**provisional, owner to confirm**).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import stats as sps

__all__ = [
    "BlandAltman",
    "ParetoTable",
    "bland_altman",
    "kde2d_grid",
    "pareto_table",
]

LOA_SD = 1.96  # limits of agreement multiplier (Bland & Altman 1986)
MIN_PAIRS = 3
MIN_KDE_POINTS = 10


@dataclass(frozen=True)
class BlandAltman:
    """Agreement statistics for paired measurements (``a`` minus ``b``)."""

    n: int
    mean_of_pairs: NDArray[np.float64]  # x axis
    difference: NDArray[np.float64]  # y axis
    bias: float
    sd: float
    k: float
    lower: float
    upper: float
    level: float
    bias_ci: tuple[float, float]
    lower_ci: tuple[float, float]
    upper_ci: tuple[float, float]
    #: Slope of difference on mean and its p-value (a trend = proportional bias).
    trend_slope: float
    trend_p: float
    #: Shapiro-Wilk p of the differences (None for n > 5000); informational.
    normality_p: float | None
    percent: bool = False
    notes: list[str] = field(default_factory=list)


def _ci(est: float, se: float, t: float) -> tuple[float, float]:
    return (est - t * se, est + t * se)


def bland_altman(
    a: ArrayLike,
    b: ArrayLike,
    *,
    level: float = 0.95,
    k: float = LOA_SD,
    percent: bool = False,
) -> BlandAltman:
    """Bland-Altman statistics of ``a - b`` against ``(a + b) / 2``.

    Non-finite pairs are dropped. ``ValueError`` on mismatched lengths, fewer
    than 3 pairs, a zero-variance difference (no limits to draw), or -- for
    ``percent`` -- a pair whose mean is zero (the ratio is undefined)."""
    av = np.asarray(a, dtype=float)
    bv = np.asarray(b, dtype=float)
    if av.shape != bv.shape or av.ndim != 1:
        raise ValueError("the two methods need equal-length columns")
    if not 0.0 < level < 1.0:
        raise ValueError("confidence level must be between 0 and 1")
    if not np.isfinite(k) or k <= 0:
        raise ValueError("the limits multiplier must be positive")
    keep = np.isfinite(av) & np.isfinite(bv)
    av, bv = av[keep], bv[keep]
    n = int(av.size)
    if n < MIN_PAIRS:
        raise ValueError(f"Bland-Altman needs at least {MIN_PAIRS} complete pairs; got {n}")
    mean = (av + bv) / 2.0
    diff = av - bv
    if percent:
        if np.any(mean == 0):
            raise ValueError("percent differences are undefined where a pair's mean is zero")
        diff = 100.0 * diff / mean
    bias = float(diff.mean())
    sd = float(diff.std(ddof=1))
    if not sd > 0:
        raise ValueError("every difference is identical: the limits of agreement have no width")
    t = float(sps.t.ppf(1.0 - (1.0 - level) / 2.0, n - 1))
    se_bias = sd / np.sqrt(n)
    se_lim = sd * np.sqrt(1.0 / n + k * k / (2.0 * (n - 1)))
    lower, upper = bias - k * sd, bias + k * sd
    trend = sps.linregress(mean, diff) if np.ptp(mean) > 0 else None
    norm_p = float(sps.shapiro(diff).pvalue) if n <= 5000 else None
    return BlandAltman(
        n=n, mean_of_pairs=mean, difference=diff, bias=bias, sd=sd, k=float(k),
        lower=float(lower), upper=float(upper), level=float(level),
        bias_ci=_ci(bias, float(se_bias), t),
        lower_ci=_ci(float(lower), float(se_lim), t),
        upper_ci=_ci(float(upper), float(se_lim), t),
        trend_slope=float(trend.slope) if trend else float("nan"),
        trend_p=float(trend.pvalue) if trend else float("nan"),
        normality_p=norm_p, percent=percent,
    )


@dataclass(frozen=True)
class ParetoTable:
    """Categories sorted by descending total, with cumulative percent."""

    labels: list[str]
    values: NDArray[np.float64]
    cumulative_pct: NDArray[np.float64]
    total: float


def pareto_table(labels: list[str], values: ArrayLike) -> ParetoTable:
    """Sum ``values`` per label, sort descending (ties keep first-seen order),
    and cumulate to 100 %. ``ValueError`` on a negative value (a Pareto chart
    is of counts / costs), a zero total, or no usable row."""
    v = np.asarray(values, dtype=float)
    if v.ndim != 1 or len(labels) != v.size:
        raise ValueError("labels and values must have the same length")
    sums: dict[str, float] = {}
    for lab, x in zip(labels, v, strict=True):
        if not np.isfinite(x):
            continue
        if x < 0:
            raise ValueError("a Pareto chart needs non-negative values")
        sums[lab] = sums.get(lab, 0.0) + float(x)
    if not sums:
        raise ValueError("no category has a finite value")
    total = float(sum(sums.values()))
    if not total > 0:
        raise ValueError("the values sum to zero")
    order = sorted(sums, key=lambda c: -sums[c])  # stable: ties keep first-seen order
    vals = np.array([sums[c] for c in order], dtype=float)
    return ParetoTable(order, vals, 100.0 * np.cumsum(vals) / total, total)


def kde2d_grid(
    x: ArrayLike,
    y: ArrayLike,
    *,
    bandwidth: str | float = "scott",
    n: int = 120,
    pad: float = 0.1,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Density of ``(x, y)`` on an ``n x n`` grid padded ``pad`` of the range
    beyond the data. Returns ``(gx, gy, z)`` with ``z[j, i]`` at ``(gx[i],
    gy[j])``. ``bandwidth`` is ``"scott"`` / ``"silverman"`` or a positive
    scalar factor (``scipy.stats.gaussian_kde``'s ``bw_method``). ``ValueError``
    on too few points or a degenerate (collinear / constant) cloud."""
    xv = np.asarray(x, dtype=float)
    yv = np.asarray(y, dtype=float)
    keep = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[keep], yv[keep]
    if xv.size < MIN_KDE_POINTS:
        raise ValueError(f"a 2-D density needs at least {MIN_KDE_POINTS} points; got {xv.size}")
    if isinstance(bandwidth, str):
        if bandwidth not in ("scott", "silverman"):
            raise ValueError("bandwidth must be 'scott', 'silverman' or a positive number")
        bw: str | float = bandwidth
    else:
        if not (np.isfinite(bandwidth) and bandwidth > 0):
            raise ValueError("bandwidth must be 'scott', 'silverman' or a positive number")
        bw = float(bandwidth)
    cov = np.cov(np.vstack([xv, yv]))
    if not (cov[0, 0] > 0 and cov[1, 1] > 0) or abs(cov[0, 1]) >= (1 - 1e-9) * np.sqrt(
        cov[0, 0] * cov[1, 1]
    ):
        raise ValueError("the points are collinear or constant: no 2-D density")
    try:
        kde = sps.gaussian_kde(np.vstack([xv, yv]), bw_method=bw)
    except np.linalg.LinAlgError as exc:  # singular covariance: collinear or constant data
        raise ValueError("the points are collinear or constant: no 2-D density") from exc
    gx = np.linspace(xv.min() - pad * np.ptp(xv), xv.max() + pad * np.ptp(xv), n)
    gy = np.linspace(yv.min() - pad * np.ptp(yv), yv.max() + pad * np.ptp(yv), n)
    mx, my = np.meshgrid(gx, gy)
    z = kde(np.vstack([mx.ravel(), my.ravel()])).reshape(mx.shape)
    return gx, gy, z
