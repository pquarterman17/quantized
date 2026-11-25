"""Response screening: many Y x X tests at once with multiplicity control.

GAP_AUDIT_9 G26, after JMP 19 *Response Screening* (Analyze > Screening).
Every response column (Y, continuous) is tested against every factor column
(X). The test follows the X modeling type:

* continuous X: simple linear regression of Y on X (slope, its t interval,
  Pearson r as the effect size, the slope's two-sided t-test p);
* nominal X with 2 levels: pooled-variance two-sample t-test (difference of
  level means with its interval, eta-squared as the effect size);
* nominal X with 3+ levels: one-way ANOVA F test (eta-squared; no single
  estimate is defined).

Missing values (None / NaN / inf) are dropped pairwise, per Y x X pair. A pair
that cannot be tested (too few rows, a constant column, a single level, no
within-level variation, a perfect fit) is returned with ``p = None`` and a
``reason``; it is never dropped silently and is left out of the multiplicity
adjustment. The raw p-values of all testable pairs are adjusted together
(``bh`` by default; ``by``, ``holm`` and ``bonferroni`` through
``adjust_pvalues``). LogWorth is ``-log10(p)`` as JMP reports it; p is floored
at 1e-300 so the value stays finite (LogWorth <= 300).

Provisional, owner to confirm: one family of tests across all pairs (JMP's
default), pooled-variance t for two levels, eta-squared / r effect sizes,
Benjamini-Hochberg default, alpha 0.05, level order = sorted level names.
Oracles (tests): scipy ``linregress`` / ``ttest_ind`` / ``f_oneway``,
``scipy.stats.false_discovery_control`` and statsmodels ``multipletests``.
Pure library: numpy + scipy only.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_anova2 import adjust_pvalues

__all__ = ["MAX_PAIRS", "response_screening"]

MAX_PAIRS = 5000
_P_FLOOR = 1e-300
XKind = Literal["continuous", "nominal"]


def _floats(values: Sequence[float | None]) -> NDArray[np.float64]:
    return np.asarray([math.nan if v is None else float(v) for v in values], dtype=float)


def _logworth(p: float | None) -> float | None:
    return None if p is None else float(-math.log10(max(p, _P_FLOOR)))


def _blank(y: str, x: str, kind: XKind, n: int, reason: str) -> dict[str, Any]:
    return {
        "y": y,
        "x": x,
        "x_kind": kind,
        "test": None,
        "n": n,
        "n_levels": None,
        "effect_label": None,
        "effect_size": None,
        "estimate_label": None,
        "estimate": None,
        "ci_low": None,
        "ci_high": None,
        "statistic": None,
        "df": None,
        "p": None,
        "p_adjusted": None,
        "logworth": None,
        "adj_logworth": None,
        "significant": False,
        "reason": reason,
    }


def _regression(
    y: NDArray[np.float64], x: NDArray[np.float64], alpha: float
) -> dict[str, Any] | str:
    n = y.size
    if n < 3:
        return f"only {n} complete row{'s' if n != 1 else ''}; regression needs at least 3"
    if np.ptp(x) == 0.0:
        return "the factor is constant among the complete rows"
    if np.ptp(y) == 0.0:
        return "the response is constant among the complete rows"
    fit = sps.linregress(x, y)
    if abs(float(fit.rvalue)) >= 1.0 - 1e-12:
        return "perfect linear fit (zero residual variance); the t-test is undefined"
    tcrit = float(sps.t.ppf(1.0 - alpha / 2.0, n - 2))
    slope, se = float(fit.slope), float(fit.stderr)
    return {
        "test": "linear regression",
        "n_levels": None,
        "effect_label": "r",
        "effect_size": float(fit.rvalue),
        "estimate_label": "slope",
        "estimate": slope,
        "ci_low": slope - tcrit * se,
        "ci_high": slope + tcrit * se,
        "statistic": slope / se,
        "df": float(n - 2),
        "p": float(fit.pvalue),
    }


def _groups(
    y: NDArray[np.float64], labels: list[str]
) -> tuple[list[str], list[NDArray[np.float64]]]:
    lab = np.asarray(labels, dtype=object)
    names = sorted(set(labels))
    return names, [y[lab == nm] for nm in names]


def _by_level(y: NDArray[np.float64], labels: list[str], alpha: float) -> dict[str, Any] | str:
    n = y.size
    names, groups = _groups(y, labels)
    k = len(groups)
    if k < 2:
        return f"only {k} level present among the complete rows; at least 2 are needed"
    if n - k < 1:
        return f"every level has a single row ({n} rows, {k} levels); no within-level variance"
    if np.ptp(y) == 0.0:
        return "the response is constant among the complete rows"
    ss_within = float(sum(np.sum((g - g.mean()) ** 2) for g in groups))
    if ss_within == 0.0:
        return "no variation within any level (perfect separation); the test is undefined"
    ss_total = float(np.sum((y - y.mean()) ** 2))
    eta2 = 1.0 - ss_within / ss_total
    out: dict[str, Any] = {"n_levels": k, "effect_label": "eta²", "effect_size": eta2}
    if k == 2:
        t = sps.ttest_ind(groups[1], groups[0], equal_var=True)
        df = float(n - 2)
        diff = float(groups[1].mean() - groups[0].mean())
        se = (
            diff / float(t.statistic)
            if t.statistic != 0.0
            else math.sqrt(ss_within / df * (1.0 / groups[0].size + 1.0 / groups[1].size))
        )
        tcrit = float(sps.t.ppf(1.0 - alpha / 2.0, df))
        out.update(
            test="two-sample t (pooled)",
            estimate_label=f"mean({names[1]}) - mean({names[0]})",
            estimate=diff,
            ci_low=diff - tcrit * se,
            ci_high=diff + tcrit * se,
            statistic=float(t.statistic),
            df=df,
            p=float(t.pvalue),
        )
    else:
        f = sps.f_oneway(*groups)
        out.update(
            test="one-way ANOVA",
            estimate_label=None,
            estimate=None,
            ci_low=None,
            ci_high=None,
            statistic=float(f.statistic),
            df=float(n - k),
            p=float(f.pvalue),
        )
    return out


def response_screening(
    y: Sequence[Sequence[float | None]],
    x: Sequence[Sequence[float | str | None]],
    *,
    y_names: Sequence[str],
    x_names: Sequence[str],
    x_kinds: Sequence[XKind],
    method: str = "bh",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Screen every Y column against every X column; see the module docstring.

    Returns ``{"results": [...], "method", "alpha", "n_pairs", "n_tested",
    "n_degenerate", "n_significant"}``. ``results`` is Y-major (all X for the
    first Y, ...); sorting is the caller's. Raises ``ValueError`` for malformed
    input (ragged columns, bad alpha / method, too many pairs).
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    if method not in ("bh", "by", "holm", "bonferroni"):
        raise ValueError(f'method must be "bh", "by", "holm" or "bonferroni", got "{method}"')
    if not y or not x:
        raise ValueError(
            "response screening needs at least one response (Y) and one factor (X) column"
        )
    if not (len(y) == len(y_names) and len(x) == len(x_names) == len(x_kinds)):
        raise ValueError("every column needs a name (and every factor a kind)")
    if any(k not in ("continuous", "nominal") for k in x_kinds):
        raise ValueError('factor kind must be "continuous" or "nominal"')
    n_rows = len(y[0])
    if any(len(c) != n_rows for c in (*y, *x)):
        raise ValueError("all columns must have the same number of rows")
    if len(y) * len(x) > MAX_PAIRS:
        raise ValueError(
            f"{len(y)} x {len(x)} = {len(y) * len(x)} pairs exceeds the limit of {MAX_PAIRS}"
        )

    ys = [_floats(c) for c in y]
    xnum: list[NDArray[np.float64] | None] = []
    xlab: list[list[str | None] | None] = []
    for col, kind in zip(x, x_kinds, strict=True):
        if kind == "continuous":
            xnum.append(_floats([None if isinstance(v, str) else v for v in col]))
            if any(isinstance(v, str) for v in col):
                raise ValueError("a continuous factor column holds text; mark it nominal")
            xlab.append(None)
        else:
            xnum.append(None)
            xlab.append(
                [
                    None
                    if v is None or (isinstance(v, float) and not math.isfinite(v))
                    else (v if isinstance(v, str) else f"{v:g}")
                    for v in col
                ]
            )

    rows: list[dict[str, Any]] = []
    for yi, yv in enumerate(ys):
        for xi, kind in enumerate(x_kinds):
            ok = np.isfinite(yv)
            xv = xnum[xi]
            labs = xlab[xi]
            if xv is not None:
                ok = ok & np.isfinite(xv)
            else:
                assert labs is not None
                ok = ok & np.asarray([lb is not None for lb in labs], dtype=bool)
            n = int(ok.sum())
            if n == 0:
                rows.append(_blank(y_names[yi], x_names[xi], kind, 0, "no complete rows"))
                continue
            if xv is not None:
                res = _regression(yv[ok], xv[ok], alpha)
            else:
                assert labs is not None
                res = _by_level(
                    yv[ok],
                    [lb for lb, keep in zip(labs, ok, strict=True) if keep and lb is not None],
                    alpha,
                )
            if isinstance(res, str):
                rows.append(_blank(y_names[yi], x_names[xi], kind, n, res))
            else:
                rows.append(
                    {**_blank(y_names[yi], x_names[xi], kind, n, ""), **res, "reason": None}
                )

    tested = [i for i, r in enumerate(rows) if r["p"] is not None]
    if tested:
        adj = adjust_pvalues([min(1.0, max(0.0, rows[i]["p"])) for i in tested], method=method)[
            "adjusted"
        ]
        for i, pa in zip(tested, adj, strict=True):
            rows[i]["p_adjusted"] = float(pa)
            rows[i]["significant"] = bool(pa < alpha)
    for r in rows:
        r["logworth"] = _logworth(r["p"])
        r["adj_logworth"] = _logworth(r["p_adjusted"])
    return {
        "results": rows,
        "method": method,
        "alpha": alpha,
        "n_pairs": len(rows),
        "n_tested": len(tested),
        "n_degenerate": len(rows) - len(tested),
        "n_significant": sum(1 for r in rows if r["significant"]),
    }
