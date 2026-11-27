"""Seasonal Mann-Kendall trend test with the seasonal Sen slope.

The Hirsch-Slack-Smith seasonal Kendall test (Hirsch, Slack & Smith 1982,
*Water Resources Research* 18:107; Hirsch & Slack 1984, 20:727; Gilbert 1987,
*Statistical Methods for Environmental Pollution Monitoring*, ch. 16): a series
observed over several seasons (months, quarters, ...) is tested for a monotonic
trend WITHIN each season, so a seasonal cycle cannot masquerade as a trend, and
the per-season statistics are added.

For season ``g`` with observations ordered by time:

* ``S_g = sum_{i<j} sign(y_j - y_i)``;
* ``Var(S_g) = [n_g (n_g-1)(2 n_g+5) - sum_p t_p (t_p-1)(2 t_p+5)] / 18`` where
  ``t_p`` are the sizes of the groups of tied ``y`` values IN THAT SEASON;
* ``S = sum_g S_g`` and ``Var(S) = sum_g Var(S_g)`` (the seasons are treated as
  independent, as in the 1982 test and in ``pymannkendall.seasonal_test``; the
  Hirsch-Slack 1984 covariance correction for serial correlation between
  seasons is NOT applied);
* ``Z = (S -/+ 1) / sqrt(Var(S))`` with the continuity correction (0 when
  ``S = 0``) and the two-sided normal ``p = 2 (1 - Phi(|Z|))``.

The seasonal Sen slope is the median of ALL within-season pairwise slopes
``(y_j - y_i) / (x_j - x_i)`` pooled over the seasons; its ``1 - alpha`` interval
uses ``C = z_{1-alpha/2} sqrt(Var(S))`` and the order statistics of the sorted
pooled slopes at ranks ``(N - C)/2`` and ``(N + C)/2 + 1`` (as in
``stats_trend.mann_kendall``). The intercept is ``median(y) - slope * median(x)``.

The season comes from a ``season`` label per observation, or from a ``period``
``P`` (seasons ``0 .. P-1`` = the time index modulo ``P``, where the time index is
``x`` when given, which must then be whole numbers, else the row order).

Refusals, each with its reason: a time value repeated inside a season; a season
label that is not usable; no season with at least 2 observations (a seasonal
trend needs at least 2 years of each season); every value tied in every usable
season (zero variance). A season with fewer than 2 finite observations is
LEFT OUT and listed in ``skipped_seasons`` with its count; a missing season in a
year costs only that observation. Non-finite pairs are dropped. Pure numpy/scipy;
checked in ``tests/test_calc_stats_trend_seasonal.py``.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_trend import MAX_N, _rank_value

__all__ = ["seasonal_mann_kendall"]

MAX_PERIOD = 1000


def _season_keys(
    xv: NDArray[np.float64], season: Any | None, period: int | None, size: int
) -> list[Any]:
    if (season is None) == (period is None):
        raise ValueError(
            "give the season either as a column of labels or as a period, not both or neither"
        )
    if period is not None:
        if int(period) != period or not 2 <= period <= MAX_PERIOD:
            raise ValueError(f"the period must be a whole number from 2 to {MAX_PERIOD}")
        finite = xv[np.isfinite(xv)]
        if np.any(finite != np.round(finite)):
            raise ValueError(
                "a period needs whole-number times (the observation index); "
                "use a season column for other times"
            )
        return [int(v) % int(period) if math.isfinite(v) else None for v in xv]
    assert season is not None  # one of season / period is given (checked above)
    labels = list(season)
    if len(labels) != size:
        raise ValueError("season and y must be the same length")
    return labels


def seasonal_mann_kendall(
    y: Any,
    x: Any | None = None,
    *,
    season: Any | None = None,
    period: int | None = None,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Seasonal Mann-Kendall test and seasonal Sen slope (see the module docstring)."""
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    yv = np.asarray(y, dtype=float).ravel()
    xv = np.arange(yv.size, dtype=float) if x is None else np.asarray(x, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must be the same length")
    keys = _season_keys(xv, season, period, yv.size)
    keep = [
        i
        for i in range(yv.size)
        if math.isfinite(xv[i])
        and math.isfinite(yv[i])
        and keys[i] is not None
        and not (isinstance(keys[i], float) and math.isnan(keys[i]))
    ]
    if len(keep) > MAX_N:
        raise ValueError(f"{len(keep)} observations; the limit is {MAX_N}")
    by_season: dict[Any, list[int]] = {}
    for i in keep:
        by_season.setdefault(keys[i], []).append(i)

    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    slopes_all: list[NDArray[np.float64]] = []
    used: list[int] = []
    s_total, var_total = 0, 0.0
    for label in sorted(by_season, key=lambda k: (isinstance(k, str), k)):
        idx = by_season[label]
        if len(idx) < 2:
            skipped.append(
                {
                    "season": label,
                    "n": len(idx),
                    "reason": "fewer than 2 observations (needs at least 2 years)",
                }
            )
            continue
        order = np.argsort(xv[idx], kind="stable")
        xs, ys = xv[idx][order], yv[idx][order]
        if np.any(np.diff(xs) <= 0.0):
            raise ValueError(
                f"season {label}: a time value is repeated inside the season; "
                "each season needs one value per time"
            )
        n = ys.size
        iu = np.triu_indices(n, k=1)
        dy = ys[iu[1]] - ys[iu[0]]
        s_g = int(np.sum(np.sign(dy)))
        _, counts = np.unique(ys, return_counts=True)
        t = counts.astype(float)
        var_g = (
            n * (n - 1.0) * (2.0 * n + 5.0) - float(np.sum(t * (t - 1.0) * (2.0 * t + 5.0)))
        ) / 18.0
        slopes = dy / (xs[iu[1]] - xs[iu[0]])
        slopes_all.append(slopes)
        used.extend(idx)
        s_total += s_g
        var_total += var_g
        rows.append(
            {
                "season": label,
                "n": int(n),
                "S": s_g,
                "var_S": var_g,
                "tie_groups": int(np.sum(counts > 1)),
                "sen_slope": float(np.median(slopes)),
            }
        )
    if not rows:
        raise ValueError(
            "no season has at least 2 observations; "
            "a seasonal trend needs at least 2 years of each season"
        )
    if var_total <= 0.0:
        raise ValueError("every value is tied within every season; there is no trend to test")
    sd = math.sqrt(var_total)
    z = 0.0 if s_total == 0 else (s_total - 1.0) / sd if s_total > 0 else (s_total + 1.0) / sd
    p = float(2.0 * sps.norm.sf(abs(z)))
    slopes_sorted = np.sort(np.concatenate(slopes_all))
    n_slopes = int(slopes_sorted.size)
    slope = float(np.median(slopes_sorted))
    c = float(sps.norm.isf(alpha / 2.0)) * sd
    pairs = sum(r["n"] * (r["n"] - 1) // 2 for r in rows)
    return {
        "n": len(used),
        "n_seasons": len(rows),
        "n_pairs": pairs,
        "S": s_total,
        "var_S": var_total,
        "Z": float(z),
        "p": p,
        "sen_slope": slope,
        "sen_ci_low": _rank_value(slopes_sorted, (n_slopes - c) / 2.0),
        "sen_ci_high": _rank_value(slopes_sorted, (n_slopes + c) / 2.0 + 1.0),
        "sen_intercept": float(np.median(yv[used]) - slope * np.median(xv[used])),
        "seasons": rows,
        "skipped_seasons": skipped,
        "alpha": float(alpha),
        "significant": bool(p < alpha),
        "trend": "no trend" if p >= alpha else ("increasing" if s_total > 0 else "decreasing"),
        "method": "Seasonal Mann-Kendall trend test with the seasonal Sen slope "
        "(seasons independent)",
    }
