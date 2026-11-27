"""Confidence intervals for one sample: the Distribution workshop's CI panel.

Item 8 of the Origin feature-gap plan. For one column of finite values, at a
chosen confidence level (default 95 %):

* **mean**: the Student t interval, ``mean +/- t(1 - a/2, n - 1) * s / sqrt(n)``
  (assumes the mean is roughly normal: exact for normal data, good for large n);
* **median**: the distribution-free order-statistic interval ``[x(l), x(n+1-l)]``.
  The number of observations below the median is Binomial(n, 1/2), so the
  interval covers the true median with probability ``1 - 2 P(B <= l - 1)``
  exactly, for any continuous distribution. ``l`` is the largest rank whose
  coverage is at least the requested level, so the achieved coverage is >= the
  level and is reported (it is a step function of n: 97.9 % for n = 10 at a
  95 % request). With fewer observations than the level needs (the widest
  interval ``[x(1), x(n)]`` covers ``1 - 2^(1 - n)``) the interval is withheld
  and the row says how many are needed. Ties do not break the guarantee;
* **standard deviation and variance**: the chi-square interval,
  ``(n - 1) s^2 / chi2(1 - a/2, n - 1)`` to ``(n - 1) s^2 / chi2(a/2, n - 1)``
  (the standard-deviation interval is its square root). This one **assumes
  normal data** and is sensitive to departures from it; the row says so;
* optionally a **bootstrap percentile** interval for the mean and the median:
  ``B`` resamples with replacement, the ``a/2`` and ``1 - a/2`` percentiles of
  the resampled statistic. The seed and resample count are fixed
  (``BOOTSTRAP_SEED``, ``BOOTSTRAP_RESAMPLES``) and returned, so the same data
  always give the same interval.

Pure numpy / scipy. Oracles (tests): ``scipy.stats.t.interval``, ``chi2.ppf``,
``binomtest`` / ``quantile_test`` for the order statistics, ``scipy.stats.bootstrap``
with the same seed, and textbook table values.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = [
    "BOOTSTRAP_MAX_N",
    "BOOTSTRAP_RESAMPLES",
    "BOOTSTRAP_SEED",
    "confidence_intervals",
    "median_interval",
]

BOOTSTRAP_SEED = 20260101
BOOTSTRAP_RESAMPLES = 10_000
#: Bootstrap cost is resamples x n; beyond this the request is refused, not thinned.
BOOTSTRAP_MAX_N = 20_000
MAX_N = 5_000_000
_CHUNK_CELLS = 4_000_000  # resample indices drawn per batch: bounds memory at ~32 MB


def median_interval(n: int, level: float) -> dict[str, Any]:
    """The 1-based ranks ``(lower, upper)`` and exact coverage of the median interval.

    ``lower``/``upper`` are ``None`` when even ``[x(1), x(n)]`` falls short of
    ``level``; ``needed_n`` then names the smallest sample that would reach it.
    """
    # Coverage of [x(l), x(n+1-l)] is 1 - 2 * P(Bin(n, 1/2) <= l - 1).
    ranks = np.arange(1, n // 2 + 1)
    coverage = 1.0 - 2.0 * sps.binom.cdf(ranks - 1, n, 0.5)
    ok = np.nonzero(coverage >= level - 1e-12)[0]
    if ok.size == 0:
        needed = int(math.ceil(1.0 - math.log2(1.0 - level))) if level < 1.0 else n + 1
        while 1.0 - 2.0 ** (1 - needed) < level - 1e-12:
            needed += 1
        return {"lower": None, "upper": None, "coverage": float(coverage[0]) if n >= 2 else None,
                "needed_n": needed}
    k = int(ok[-1])  # the largest rank still reaching the level: the narrowest interval
    return {"lower": int(ranks[k]), "upper": int(n + 1 - ranks[k]), "coverage": float(coverage[k]),
            "needed_n": None}


def _bootstrap(x: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Resampled means and medians (``BOOTSTRAP_RESAMPLES`` each), from the fixed seed."""
    n = x.size
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    means = np.empty(BOOTSTRAP_RESAMPLES)
    medians = np.empty(BOOTSTRAP_RESAMPLES)
    step = max(1, min(BOOTSTRAP_RESAMPLES, _CHUNK_CELLS // n))
    done = 0
    while done < BOOTSTRAP_RESAMPLES:
        size = min(step, BOOTSTRAP_RESAMPLES - done)
        draws = x[rng.integers(0, n, size=(size, n), dtype=np.int64)]
        means[done:done + size] = draws.mean(axis=1)
        medians[done:done + size] = np.median(draws, axis=1)
        done += size
    return means, medians


def _row(
    statistic: str, method: str, estimate: float, low: float | None, high: float | None,
    level: float, note: str | None = None, **extra: Any,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "statistic": statistic, "method": method, "estimate": float(estimate),
        "low": None if low is None else float(low), "high": None if high is None else float(high),
        "level": float(level), "note": note,
    }
    out.update(extra)
    return out


def confidence_intervals(x: Any, *, level: float = 0.95, bootstrap: bool = False) -> dict[str, Any]:
    """Every interval for one sample; see the module docstring for each method.

    ``x`` is a 1-D sequence; non-finite values are dropped (their count is returned
    as ``n_dropped``). Needs at least 2 finite values. Returns ``{"rows": [...]}``
    in the order mean, median, standard deviation, variance, then (with
    ``bootstrap``) bootstrap mean and median; each row has ``statistic``,
    ``method``, ``estimate``, ``low``, ``high``, ``level`` (the coverage the
    interval actually has: the requested level, except the median's exact one),
    ``note`` and, for the median, ``rank_low`` / ``rank_high``.
    """
    if not 0.5 <= level < 1.0:
        raise ValueError("the confidence level must be at least 50% and below 100%")
    raw = np.asarray(x, dtype=float).ravel()
    arr = raw[np.isfinite(raw)]
    n = int(arr.size)
    if n < 2:
        raise ValueError("a confidence interval needs at least 2 finite values")
    if n > MAX_N:
        raise ValueError(f"{n} values is over the limit of {MAX_N}")
    if bootstrap and n > BOOTSTRAP_MAX_N:
        raise ValueError(
            f"the bootstrap is limited to {BOOTSTRAP_MAX_N} values ({n} given); "
            "switch it off to get the other intervals"
        )
    alpha = 1.0 - level
    mean = float(np.mean(arr))
    median = float(np.median(arr))
    var = float(np.var(arr, ddof=1))
    sd = math.sqrt(var)

    rows: list[dict[str, Any]] = []
    half = float(sps.t.ppf(1.0 - alpha / 2.0, n - 1)) * sd / math.sqrt(n)
    rows.append(_row("mean", "t interval", mean, mean - half, mean + half, level,
                     "Assumes the mean is approximately normal (exact for normal data)."))

    mi = median_interval(n, level)
    if mi["lower"] is None:
        rows.append(_row(
            "median", "order statistics (distribution-free)", median, None, None, level,
            f"Needs at least {mi['needed_n']} values for a {level * 100:g}% interval "
            f"(the widest interval, from the smallest to the largest, covers "
            f"{mi['coverage'] * 100:.1f}%).", rank_low=None, rank_high=None,
        ))
    else:
        srt = np.sort(arr)
        achieved = mi["coverage"]
        rows.append(_row(
            "median", "order statistics (distribution-free)", median,
            srt[mi["lower"] - 1], srt[mi["upper"] - 1], achieved,
            f"Exact coverage {achieved * 100:.2f}% (the interval from rank {mi['lower']} "
            f"to rank {mi['upper']} of {n}); coverage moves in steps with n, so it is "
            f"at least {level * 100:g}% but rarely exactly that.",
            rank_low=mi["lower"], rank_high=mi["upper"],
        ))

    chi_note = "Assumes normal data; sensitive to departures from normality."
    ss = (n - 1) * var
    v_lo = ss / float(sps.chi2.ppf(1.0 - alpha / 2.0, n - 1))
    v_hi = ss / float(sps.chi2.ppf(alpha / 2.0, n - 1))
    rows.append(_row("standard deviation", "chi-square interval", sd, math.sqrt(v_lo),
                     math.sqrt(v_hi), level, chi_note))
    rows.append(_row("variance", "chi-square interval", var, v_lo, v_hi, level, chi_note))

    boot: dict[str, Any] | None = None
    if bootstrap:
        means, medians = _bootstrap(arr)
        pct = [100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)]
        note = (f"Percentile interval from {BOOTSTRAP_RESAMPLES} resamples, seed {BOOTSTRAP_SEED}; "
                "the same data always give the same interval.")
        for name, est, draws in (("mean", mean, means), ("median", median, medians)):
            lo, hi = np.percentile(draws, pct)
            rows.append(_row(name, "bootstrap percentile", est, lo, hi, level, note))
        boot = {"seed": BOOTSTRAP_SEED, "resamples": BOOTSTRAP_RESAMPLES}

    return {
        "rows": rows, "n": n, "n_dropped": int(raw.size - n), "level": float(level),
        "bootstrap": boot,
    }
