"""Row-wise t-tests: one t-test per worksheet row, across a block of columns.

Origin's *Row Statistics > Row-wise t-test* and its ``rowttest1/2/paired``
X-Functions (item 8 of the Origin feature-gap plan). Each row of a numeric
block is its own tiny experiment: the cells of group A across that row are the
sample (and the cells of group B the second sample), so a worksheet of
replicate columns yields one t, df, p, difference and confidence interval per
row. Three designs:

* ``two-sample``: A against B (independent samples), difference ``mean(A) -
  mean(B)``;
* ``one-sample``: A against the value ``mu``, estimate ``mean(A)``;
* ``paired``: column ``k`` of A is paired with column ``k`` of B, the sample is
  the differences ``A_k - B_k`` and the estimate is their mean.

``mu`` is the null value of the estimate (a hypothesised mean, or a
hypothesised difference of means; ``0`` is the usual null). ``diff`` is always
the estimate itself, not the estimate minus ``mu``, and the reported interval is
the two-sided ``1 - alpha`` interval for that estimate whatever the alternative.

Two variance models for the two-sample design, chosen explicitly:

* ``pooled`` (Student): equal variances, ``df = n1 + n2 - 2`` and the pooled
  standard error. **This is what Origin's row-wise test does** (checked against
  its ``rowttest2`` in ``tests/test_origin_oracle_compare_extras_signal.py``);
* ``welch``: unequal variances, Welch-Satterthwaite fractional ``df``; this is
  what quantized's single ``t_test`` does. On Origin's 8-row fixture the two
  p-values differ by up to 0.054, so the choice is never made silently.

Missing cells (NaN / inf, or ``None`` on the wire) are dropped within the row.
A row that cannot be tested (too few values for the design, or zero variance so
the standard error is 0) is returned with null statistics and a ``status``
saying why; it is never dropped, so the output keeps one row per input row.

Pure numpy / scipy. Oracles (tests): ``scipy.stats.ttest_ind`` (both variance
models), ``ttest_1samp``, ``ttest_rel``, the existing ``calc.stats.t_test`` and
Origin's frozen ``rowttest2`` p-values.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = ["MAX_ROWS", "row_t_tests"]

MAX_ROWS = 200_000
_ALTERNATIVES = ("two-sided", "less", "greater")
_NEEDS = {
    "paired": "at least 2 complete pairs",
    "one-sample": "at least 2 values",
    "pooled": "at least 1 value in each group and 3 in all (pooled)",
    "welch": "at least 2 values in each group (Welch)",
}


def _block(values: Any, name: str) -> NDArray[np.float64]:
    a = np.array(values, dtype=float)
    if a.ndim != 2 or a.shape[0] < 1 or a.shape[1] < 1:
        raise ValueError(f"{name} must be a block of at least one row and one column")
    if a.shape[0] > MAX_ROWS:
        raise ValueError(f"{name} has {a.shape[0]} rows; the limit is {MAX_ROWS}")
    a[~np.isfinite(a)] = np.nan
    return a


def _count(x: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(np.sum(np.isfinite(x), axis=1), dtype=float)


def _row_mean(x: NDArray[np.float64], n: NDArray[np.float64]) -> NDArray[np.float64]:
    total = np.sum(np.where(np.isfinite(x), x, 0.0), axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(n > 0, total / n, np.nan)


def _row_var(x: NDArray[np.float64], n: NDArray[np.float64]) -> NDArray[np.float64]:
    """Unbiased (ddof = 1) variance of each row's finite cells; NaN below 2 cells."""
    mean = _row_mean(x, n)
    ss = np.sum(np.where(np.isfinite(x), (x - mean[:, None]) ** 2, 0.0), axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(n > 1, ss / (n - 1.0), np.nan)


def _p_value(
    t: NDArray[np.float64], df: NDArray[np.float64], alternative: str
) -> NDArray[np.float64]:
    if alternative == "two-sided":
        return np.asarray(2.0 * sps.t.sf(np.abs(t), df), dtype=float)
    if alternative == "less":
        return np.asarray(sps.t.cdf(t, df), dtype=float)
    return np.asarray(sps.t.sf(t, df), dtype=float)


def _f(v: float) -> float | None:
    return float(v) if np.isfinite(v) else None


def row_t_tests(
    a: Any,
    b: Any | None = None,
    *,
    design: str = "two-sample",
    variance: str = "pooled",
    mu: float = 0.0,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """One t-test per row; see the module docstring for the designs and models.

    ``a`` (and ``b`` for two-sample / paired) is a 2-D block, rows by columns.
    ``variance`` (``"pooled"`` or ``"welch"``) only matters for ``two-sample``.
    Returns ``{"rows": [...], ...}`` with one dict per input row: ``n1``,
    ``n2``, ``mean1``, ``mean2``, ``diff``, ``se``, ``t``, ``df``, ``p``,
    ``ci_low``, ``ci_high`` and ``status`` (``"ok"`` or why it was not tested).
    For ``paired`` ``n1`` is the number of complete pairs and ``mean1`` the mean
    difference.
    """
    if design not in ("two-sample", "one-sample", "paired"):
        raise ValueError(f"design must be two-sample, one-sample or paired, got {design!r}")
    if variance not in ("pooled", "welch"):
        raise ValueError(f"variance must be pooled or welch, got {variance!r}")
    if alternative not in _ALTERNATIVES:
        raise ValueError(f"alternative must be one of {_ALTERNATIVES}, got {alternative!r}")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    if not np.isfinite(mu):
        raise ValueError("mu must be finite")
    ga = _block(a, "group A")
    gb: NDArray[np.float64] | None = None
    if design != "one-sample":
        if b is None:
            raise ValueError(f"the {design} design needs a second group of columns (group B)")
        gb = _block(b, "group B")
        if gb.shape[0] != ga.shape[0]:
            raise ValueError("group A and group B must have the same number of rows")
        if design == "paired" and gb.shape[1] != ga.shape[1]:
            raise ValueError("the paired design needs the same number of columns in A and B")

    rows = ga.shape[0]
    n2 = np.zeros(rows)
    mean2 = np.full(rows, np.nan)
    if design == "paired":
        assert gb is not None
        sample = ga - gb  # a missing cell in either column drops that pair
    else:
        sample = ga
    n1 = _count(sample)
    mean1 = _row_mean(sample, n1)
    var1 = _row_var(sample, n1)
    if design == "two-sample":
        assert gb is not None
        n2 = _count(gb)
        mean2 = _row_mean(gb, n2)
        var2 = _row_var(gb, n2)

    with np.errstate(divide="ignore", invalid="ignore"):
        if design == "two-sample":
            diff = mean1 - mean2
            if variance == "pooled":
                df = n1 + n2 - 2.0
                sp2 = ((n1 - 1.0) * np.nan_to_num(var1) + (n2 - 1.0) * np.nan_to_num(var2)) / df
                se = np.sqrt(sp2 * (1.0 / n1 + 1.0 / n2))
                short = (n1 < 1) | (n2 < 1) | (df < 1)
            else:
                v1n, v2n = var1 / n1, var2 / n2
                se = np.sqrt(v1n + v2n)
                df = (v1n + v2n) ** 2 / (v1n**2 / (n1 - 1.0) + v2n**2 / (n2 - 1.0))
                short = (n1 < 2) | (n2 < 2)
        else:
            diff = mean1
            df = n1 - 1.0
            se = np.sqrt(var1 / n1)
            short = n1 < 2
        ok = ~short & (se > 0.0)
        t = np.where(ok, (diff - mu) / se, np.nan)
        df = np.where(ok, df, np.nan)
        se = np.where(ok, se, np.nan)
        p = np.where(ok, _p_value(t, df, alternative), np.nan)
        crit = np.where(ok, sps.t.ppf(1.0 - alpha / 2.0, df), np.nan)
        lo, hi = diff - crit * se, diff + crit * se

    need = _NEEDS[design if design != "two-sample" else variance]
    out = []
    for i in range(rows):
        if ok[i]:
            status = "ok"
        elif short[i]:
            status = f"too few values: needs {need}"
        else:
            status = "zero variance in this row: the standard error is 0"
        out.append({
            "row": i, "n1": int(n1[i]), "n2": int(n2[i]), "mean1": _f(mean1[i]),
            "mean2": _f(mean2[i]),
            "diff": _f(diff[i]), "se": _f(se[i]), "t": _f(t[i]), "df": _f(df[i]), "p": _f(p[i]),
            "ci_low": _f(lo[i]), "ci_high": _f(hi[i]), "status": status,
        })
    method = f"Row-wise {design} t-test"
    if design == "two-sample":
        method += (
            " (Student, pooled variance)" if variance == "pooled" else " (Welch, unequal variances)"
        )
    return {
        "rows": out, "n_rows": rows, "design": design,
        "variance": variance if design == "two-sample" else None,
        "mu": float(mu), "alpha": float(alpha), "alternative": alternative, "method": method,
        "n_tested": int(np.sum(ok)),
    }
