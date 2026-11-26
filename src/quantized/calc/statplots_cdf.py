"""CDF / ECDF plot primitives and the geometry both renderers draw.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types), first type. Pure
numpy/scipy; the Stat Stage's canvas (``frontend/src/lib/statCdf.ts``) and the
matplotlib export (``calc.figure_cdf``) read the same numbers and build the
same vertices, pinned by ``tests/fixtures/wire/stat_cdf_rug.json``.

Conventions, each stated once here:

- **ECDF.** ``F(x) = #{v <= x} / n`` over the finite values: a right-continuous
  step function, one step per DISTINCT value (ties make one taller step).
  ``y="count"`` multiplies by ``n`` (so a step is the number of values at or
  below ``x``).
- **Confidence band.** The Dvoretzky-Kiefer-Massart (DKW) inequality gives a
  distribution-free simultaneous band ``F_n(x) +- eps`` with
  ``eps = sqrt(ln(2 / alpha) / (2 n))``, clipped to ``[0, 1]``: it contains the
  true CDF everywhere with probability at least ``1 - alpha``. (Massart's
  sharp constant; the band is conservative, not exact.) ``alpha = 0.05``.
- **Fitted CDF.** ``scipy.stats.<dist>.fit`` (maximum likelihood, the same
  call the histogram's fit overlay makes) evaluated on a fixed grid across the
  plot's domain, one per column.
- **Domain.** The pooled finite range padded by 5 % of its width on each side
  (a constant sample gets +-0.5), shared by every column so steps, band and fit
  start and end at the same edges.
- **Rug.** One tick per finite value (ties draw on top of each other), from
  ``k * length`` to ``(k + 1) * length`` in axes-fraction height for column
  ``k``, so several columns each get their own row along the X axis.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import stats as sps

__all__ = [
    "CDF_Y_SCALES",
    "DKW_ALPHA",
    "FIT_GRID_POINTS",
    "RUG_LENGTH_DEFAULT",
    "RUG_OPACITY_DEFAULT",
    "cdf_geometry",
    "cdf_series",
    "dkw_band",
    "dkw_epsilon",
    "ecdf",
    "padded_domain",
    "rug_ticks",
    "stair_path",
]

CDF_Y_SCALES = ("proportion", "count")
DKW_ALPHA = 0.05
FIT_GRID_POINTS = 256
RUG_LENGTH_DEFAULT = 0.04  # axes-fraction height of one rug row
RUG_OPACITY_DEFAULT = 0.5
_MAX_COLUMNS = 64

Point = tuple[float, float]


def _finite(x: ArrayLike) -> NDArray[np.float64]:
    v = np.asarray(x, dtype=float).ravel()
    return np.asarray(v[np.isfinite(v)], dtype=float)


def ecdf(values: ArrayLike) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """``(x, F)``: the distinct finite values ascending and ``F`` at each
    (the proportion of values ``<= x``). Raises with no finite value."""
    v = _finite(values)
    if v.size == 0:
        raise ValueError("a CDF needs at least one finite value")
    x, counts = np.unique(v, return_counts=True)
    return np.asarray(x, dtype=float), np.asarray(np.cumsum(counts) / v.size, dtype=float)


def dkw_epsilon(n: int, alpha: float = DKW_ALPHA) -> float:
    """The DKW half-width ``sqrt(ln(2 / alpha) / (2 n))`` of the ``1 - alpha``
    band around an ECDF of ``n`` values."""
    if n < 1:
        raise ValueError("the DKW band needs at least one value")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must lie strictly between 0 and 1")
    return float(np.sqrt(np.log(2.0 / alpha) / (2.0 * n)))


def dkw_band(
    f: NDArray[np.float64], n: int, alpha: float = DKW_ALPHA
) -> tuple[NDArray[np.float64], NDArray[np.float64], float]:
    """``(lo, hi, eps)``: ``F -+ eps`` clipped to ``[0, 1]``."""
    eps = dkw_epsilon(n, alpha)
    return (
        np.asarray(np.clip(f - eps, 0.0, 1.0), dtype=float),
        np.asarray(np.clip(f + eps, 0.0, 1.0), dtype=float),
        eps,
    )


def _domain(columns: Sequence[NDArray[np.float64]]) -> tuple[float, float]:
    pooled = np.concatenate(columns)
    lo, hi = float(pooled.min()), float(pooled.max())
    pad = 0.05 * (hi - lo) if hi > lo else 0.5
    return lo - pad, hi + pad


padded_domain = _domain  # public: the marginal plot shares the 5 % padding rule


def _fit_curve(
    v: NDArray[np.float64], dist: str, domain: tuple[float, float], scale: float
) -> dict[str, Any]:
    rv = getattr(sps, dist, None)
    if not isinstance(rv, sps.rv_continuous):
        raise ValueError(f"unknown distribution '{dist}'")  # e.g. 'kstest' is a function
    if v.size < 2 or float(np.ptp(v)) == 0.0:
        raise ValueError("a distribution fit needs at least 2 distinct finite values")
    params = rv.fit(v)
    grid = np.linspace(domain[0], domain[1], FIT_GRID_POINTS)
    cdf = np.asarray(rv.cdf(grid, *params), dtype=float)
    if not np.all(np.isfinite(cdf)):
        raise ValueError(f"the {dist} fit did not converge on this sample")
    return {
        "dist": dist,
        "params": [float(p) for p in params],
        "x": [float(g) for g in grid],
        "y": [float(c * scale) for c in cdf],
    }


def cdf_series(
    columns: Sequence[ArrayLike],
    *,
    y: str = "proportion",
    band: bool = False,
    alpha: float = DKW_ALPHA,
    fit: str | None = None,
) -> dict[str, Any]:
    """Everything a CDF plot of ``columns`` draws, in the requested Y scale.

    ``series[k]`` holds ``x`` (distinct values), ``y`` (the step heights), ``n``
    and, when asked, ``band`` (``lo`` / ``hi`` aligned with ``x``, ``lo0`` /
    ``hi0`` the level LEFT of the first value, and ``eps`` as a proportion) and
    ``fit`` (a curve on ``FIT_GRID_POINTS`` points over ``domain``). A column
    with no finite value is refused: a CDF of nothing has no line to draw.
    """
    if y not in CDF_Y_SCALES:
        raise ValueError(f"y must be one of {CDF_Y_SCALES}")
    if not 1 <= len(columns) <= _MAX_COLUMNS:
        raise ValueError(f"a CDF plot takes 1 to {_MAX_COLUMNS} columns")
    cols = [_finite(c) for c in columns]
    if any(c.size == 0 for c in cols):
        raise ValueError("every column needs at least one finite value")
    domain = _domain(cols)
    y_max = float(max(c.size for c in cols)) if y == "count" else 1.0
    series: list[dict[str, Any]] = []
    for v in cols:
        n = int(v.size)
        scale = float(n) if y == "count" else 1.0
        x, f = ecdf(v)
        entry: dict[str, Any] = {
            "n": n, "x": [float(a) for a in x], "y": [float(b * scale) for b in f],
        }
        if band:
            lo, hi, eps = dkw_band(f, n, alpha)
            entry["band"] = {
                "eps": eps,
                "lo": [float(b * scale) for b in lo],
                "hi": [float(b * scale) for b in hi],
                "lo0": 0.0,
                "hi0": min(eps, 1.0) * scale,
            }
        if fit is not None:
            entry["fit"] = _fit_curve(v, fit, domain, scale)
        series.append(entry)
    return {
        "y": y, "domain": [domain[0], domain[1]], "y_max": y_max, "alpha": alpha,
        "fit": fit, "series": series,
    }


def stair_path(
    x: Sequence[float], y: Sequence[float], x_lo: float, x_hi: float, y_start: float
) -> list[Point]:
    """The vertices of a right-continuous step function: from ``(x_lo, y_start)``
    run level to each ``x[j]``, rise to ``y[j]``, and finish level at ``x_hi``."""
    pts: list[Point] = [(float(x_lo), float(y_start))]
    prev = float(y_start)
    for xj, yj in zip(x, y, strict=True):
        pts.append((float(xj), prev))
        pts.append((float(xj), float(yj)))
        prev = float(yj)
    pts.append((float(x_hi), prev))
    return pts


def cdf_geometry(result: dict[str, Any]) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`cdf_series` result (or
    its JSON): per column the ``step`` path, the ``band`` polygon (the upper
    stairs, then the lower ones back) and the ``fit`` polyline."""
    lo, hi = result["domain"]
    out: list[dict[str, Any]] = []
    for s in result["series"]:
        g: dict[str, Any] = {
            "step": stair_path(s["x"], s["y"], lo, hi, 0.0), "band": None, "fit": None,
        }
        b = s.get("band")
        if b:
            upper = stair_path(s["x"], b["hi"], lo, hi, b["hi0"])
            lower = stair_path(s["x"], b["lo"], lo, hi, b["lo0"])
            g["band"] = upper + lower[::-1]
        f = s.get("fit")
        if f:
            g["fit"] = list(zip(f["x"], f["y"], strict=True))
        out.append(g)
    return {"domain": [lo, hi], "y_max": result["y_max"], "series": out}


def rug_ticks(
    values: ArrayLike, row: int = 0, length: float = RUG_LENGTH_DEFAULT
) -> list[tuple[float, float, float]]:
    """``(x, y0, y1)`` of one tick per finite value, in data X and axes-fraction
    Y: row ``row`` spans ``row * length`` to ``(row + 1) * length``."""
    y0, y1 = row * length, (row + 1) * length
    return [(float(x), y0, y1) for x in _finite(values)]
