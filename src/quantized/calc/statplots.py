"""Statistical-plot primitives: box/whisker, violin KDE, Q-Q, histogram.

ORIGIN_GAP_PLAN #16 (calc math). Pure numpy/scipy — the same numbers drive
the interactive (uPlot / Canvas) stage and the matplotlib publication export,
so the two are guaranteed identical.

Design choices pinned to standard references so the tests can use exact
oracles:

- ``box_stats`` reproduces ``matplotlib.cbook.boxplot_stats`` (linear-
  interpolation quartiles + Tukey 1.5*IQR whisker rule + fliers), so an
  interactive box and an exported box show the same whiskers and outliers.
- ``histogram`` delegates bin selection to ``numpy.histogram``'s documented
  rules (``fd`` / ``sturges`` / ``scott`` / ``rice`` / ``sqrt`` / ``auto``).
- ``qq_plot`` uses Blom plotting positions; its fitted reference line is
  cross-checked against ``scipy.stats.probplot``.
- ``violin_kde`` wraps ``scipy.stats.gaussian_kde`` (Scott / Silverman).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = [
    "box_stats",
    "grouped_box_stats",
    "histogram",
    "qq_plot",
    "violin_kde",
]


def _finite(x: NDArray[np.float64] | list[float]) -> NDArray[np.float64]:
    v = np.asarray(x, dtype=float).ravel()
    return np.asarray(v[np.isfinite(v)], dtype=float)


def box_stats(
    data: NDArray[np.float64] | list[float],
    *,
    whis: float | str = 1.5,
) -> dict[str, Any]:
    """Box-and-whisker statistics matching ``matplotlib.cbook.boxplot_stats``.

    Quartiles use linear interpolation (numpy default / matplotlib boxplot).
    ``whis`` is either the IQR multiplier for Tukey whiskers (default 1.5 —
    whiskers reach the most extreme datum within ``Q1 - whis*IQR`` ..
    ``Q3 + whis*IQR``, points beyond are fliers/outliers) or the string
    ``"range"`` for min/max whiskers (no outliers).
    """
    v = _finite(data)
    if v.size == 0:
        raise ValueError("box_stats needs at least one finite value")
    q1, med, q3 = (float(x) for x in np.percentile(v, [25, 50, 75]))
    iqr = q3 - q1
    if whis == "range":
        whislo, whishi = float(v.min()), float(v.max())
    else:
        k = float(whis)
        lo_fence, hi_fence = q1 - k * iqr, q3 + k * iqr
        below, above = v[v >= lo_fence], v[v <= hi_fence]
        whislo = float(below.min()) if below.size else q1
        whishi = float(above.max()) if above.size else q3
    fliers = v[(v < whislo) | (v > whishi)]
    return {
        "q1": q1, "median": med, "q3": q3, "iqr": iqr,
        "whislo": whislo, "whishi": whishi,
        "mean": float(v.mean()),
        "n": int(v.size),
        "fliers": [float(x) for x in np.sort(fliers)],
        "whis": whis,
    }


def grouped_box_stats(
    groups: list[NDArray[np.float64]] | list[list[float]],
    *,
    labels: list[str] | None = None,
    whis: float | str = 1.5,
) -> dict[str, Any]:
    """``box_stats`` for each group; the payload a grouped box plot consumes."""
    if labels is not None and len(labels) != len(groups):
        raise ValueError("labels length must match the number of groups")
    boxes = []
    for i, g in enumerate(groups):
        stats = box_stats(np.asarray(g, dtype=float), whis=whis)
        stats["label"] = labels[i] if labels else f"group {i + 1}"
        boxes.append(stats)
    return {"boxes": boxes, "n_groups": len(boxes)}


def violin_kde(
    data: NDArray[np.float64] | list[float],
    *,
    bw_method: str | float = "scott",
    n_points: int = 128,
    cut: float = 2.0,
) -> dict[str, Any]:
    """Gaussian-KDE density for a violin plot.

    Evaluates ``scipy.stats.gaussian_kde`` on a grid spanning the data
    extended by ``cut`` bandwidths on each side (seaborn's convention). The
    returned ``density`` integrates to ~1 over the grid; the caller mirrors
    it about the category axis to draw the violin.
    """
    v = _finite(data)
    if v.size < 2:
        raise ValueError("violin_kde needs at least 2 finite values")
    if float(np.ptp(v)) == 0.0:
        raise ValueError("violin_kde needs non-constant data")
    kde = sps.gaussian_kde(v, bw_method=bw_method)
    bw = float(np.sqrt(kde.covariance[0, 0]))  # effective bandwidth (std units)
    lo, hi = float(v.min()) - cut * bw, float(v.max()) + cut * bw
    grid = np.linspace(lo, hi, int(n_points))
    density = np.asarray(kde(grid), dtype=float)
    return {
        "x": [float(x) for x in grid],
        "density": [float(d) for d in density],
        "bandwidth": bw,
        "quartiles": [float(x) for x in np.percentile(v, [25, 50, 75])],
        "n": int(v.size),
    }


def _blom_positions(n: int) -> NDArray[np.float64]:
    """Blom plotting positions (i - 3/8)/(n + 1/4): the normal-QQ standard."""
    i = np.arange(1, n + 1, dtype=float)
    return np.asarray((i - 0.375) / (n + 0.25), dtype=float)


def qq_plot(
    data: NDArray[np.float64] | list[float],
    *,
    dist: str = "norm",
) -> dict[str, Any]:
    """Quantile-quantile / probability-plot coordinates against ``dist``.

    Sorts the sample (``sample_quantiles``) and pairs it with the theoretical
    quantiles (``theoretical_quantiles``) of ``dist`` at Blom plotting
    positions. Fits a reference line by least squares; for a perfect fit the
    points fall on it. ``dist`` is any location-scale ``scipy.stats``
    continuous distribution name (``norm``, ``logistic``, ``laplace``, ...).
    """
    v = _finite(data)
    if v.size < 3:
        raise ValueError("qq_plot needs at least 3 finite values")
    try:
        rv = getattr(sps, dist)
    except AttributeError as exc:
        raise ValueError(f"unknown distribution '{dist}'") from exc
    ordered = np.sort(v)
    theo = np.asarray(rv.ppf(_blom_positions(v.size)), dtype=float)
    slope, intercept, r, _, _ = sps.linregress(theo, ordered)
    return {
        "theoretical_quantiles": [float(x) for x in theo],
        "sample_quantiles": [float(x) for x in ordered],
        "slope": float(slope),
        "intercept": float(intercept),
        "r_squared": float(r) ** 2,
        "dist": dist,
        "n": int(v.size),
    }


def histogram(
    data: NDArray[np.float64] | list[float],
    *,
    bins: str | int = "fd",
    density: bool = False,
    fit: str | None = None,
) -> dict[str, Any]:
    """Histogram with a data-driven bin rule and an optional fit overlay.

    ``bins`` is a numpy bin rule (``"fd"``, ``"sturges"``, ``"scott"``,
    ``"rice"``, ``"sqrt"``, ``"auto"``) or an explicit integer count.
    ``fit="norm"`` (or another location-scale ``scipy.stats`` name) adds a
    fitted PDF sampled on a fine grid over the data range, for the
    distribution-fit overlay.
    """
    v = _finite(data)
    if v.size < 2:
        raise ValueError("histogram needs at least 2 finite values")
    counts, edges = np.histogram(v, bins=bins, density=density)
    centers = 0.5 * (edges[:-1] + edges[1:])
    out: dict[str, Any] = {
        "counts": [float(c) for c in counts],
        "edges": [float(e) for e in edges],
        "centers": [float(c) for c in centers],
        "n_bins": int(counts.size),
        "n": int(v.size),
        "density": density,
        "bins": bins,
    }
    if fit is not None:
        try:
            rv = getattr(sps, fit)
        except AttributeError as exc:
            raise ValueError(f"unknown distribution '{fit}'") from exc
        params = rv.fit(v)
        grid = np.linspace(float(v.min()), float(v.max()), 256)
        pdf = np.asarray(rv.pdf(grid, *params), dtype=float)
        out["fit"] = {
            "dist": fit,
            "params": [float(p) for p in params],
            "x": [float(x) for x in grid],
            "pdf": [float(p) for p in pdf],
        }
    return out
