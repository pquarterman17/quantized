"""Unequal-variance group comparison: Welch ANOVA, post-hoc tests, variance tests.

GAP_AUDIT_9 G6. Pure numpy/scipy (BSD); no pingouin (GPL) and nothing ported
from it. Every function takes a list of 1-D samples and returns a plain dict.

References (formulas, not code):
- Welch, B. L. (1951), "On the comparison of several mean values: an
  alternative approach", Biometrika 38, 330-336 (Welch ANOVA).
- Games, P. A. & Howell, J. F. (1976), J. Educ. Stat. 1, 113-125
  (Games-Howell: Welch t with Satterthwaite df, studentized-range p).
- Scheffe, H. (1953), Biometrika 40, 87-104; Fisher (1935) LSD
  (pooled-MSE contrasts; see NIST/SEMATECH e-Handbook 7.4.7.1).
- Bartlett, M. S. (1937); NIST/SEMATECH e-Handbook section 1.3.5.7.
- NIST/SEMATECH e-Handbook of Statistical Methods, section 1.3.5.8 (F-test).
- JMP Oneway "Games-Howell" (new in JMP 19) and OriginPro Welch ANOVA.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_anova2 import tukey_hsd
from quantized.calc.stats_tests import levene

POSTHOC_METHODS = ("tukey", "games-howell", "scheffe", "lsd")
VARIANCE_METHODS = ("bartlett", "levene", "brown-forsythe", "f-test")


def _groups(
    groups: list[NDArray[np.float64]], *, min_n: int = 2, min_k: int = 2
) -> list[NDArray[np.float64]]:
    out: list[NDArray[np.float64]] = []
    for g in groups:
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size < min_n:
            raise ValueError(f"every group needs at least {min_n} finite observations")
        out.append(v)
    if len(out) < min_k:
        raise ValueError(f"need at least {min_k} groups")
    return out


def _check_alpha(alpha: float) -> None:
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")


def _positive_variances(gs: list[NDArray[np.float64]]) -> NDArray[np.float64]:
    var = np.array([np.var(g, ddof=1) for g in gs], dtype=float)
    if np.any(var <= 0.0):
        raise ValueError(
            "a group has zero variance (all values identical); the method is undefined"
        )
    return var


def welch_anova(groups: list[NDArray[np.float64]], *, alpha: float = 0.05) -> dict[str, Any]:
    """Welch's heteroscedastic one-way ANOVA (Welch 1951).

    ``F = [sum w_i (m_i - m')^2 / (k-1)] / [1 + 2(k-2)/(k^2-1) * L]`` with
    ``w_i = n_i/s_i^2``, ``m' = sum w_i m_i / sum w_i`` and
    ``L = sum (1 - w_i/W)^2/(n_i-1)``; ``df1 = k-1``, ``df2 = (k^2-1)/(3L)``.
    ``omega_sq`` is an APPROXIMATE effect size, ``df1 (F-1) / (df1 (F-1) + N)``
    floored at 0 (provisional, owner to confirm); the classical ANOVA F is
    also returned for comparison.
    """
    _check_alpha(alpha)
    gs = _groups(groups)
    k = len(gs)
    n = np.array([g.size for g in gs], dtype=float)
    mean = np.array([np.mean(g) for g in gs], dtype=float)
    var = _positive_variances(gs)
    w = n / var
    w_sum = float(np.sum(w))
    m_w = float(np.sum(w * mean) / w_sum)
    lam = float(np.sum((1.0 - w / w_sum) ** 2 / (n - 1.0)))
    num = float(np.sum(w * (mean - m_w) ** 2) / (k - 1))
    f = num / (1.0 + 2.0 * (k - 2) / (k * k - 1.0) * lam)
    df1 = float(k - 1)
    df2 = (k * k - 1.0) / (3.0 * lam)
    p = float(sps.f.sf(f, df1, df2))
    total = float(np.sum(n))
    omega = max(0.0, df1 * (f - 1.0) / (df1 * (f - 1.0) + total))
    classical = sps.f_oneway(*gs)
    return {
        "F": float(f),
        "df1": df1,
        "df2": float(df2),
        "p": p,
        "omega_sq": float(omega),
        "alpha": alpha,
        "significant": bool(p < alpha),
        "n_groups": k,
        "N": int(total),
        "groups": [
            {"index": i, "n": int(n[i]), "mean": float(mean[i]), "sd": float(np.sqrt(var[i]))}
            for i in range(k)
        ],
        "classical_F": float(classical.statistic),
        "classical_p": float(classical.pvalue),
        "method": "Welch ANOVA",
    }


def _pooled_rows(
    gs: list[NDArray[np.float64]], method: str, alpha: float
) -> tuple[list[dict[str, Any]], float]:
    k = len(gs)
    n = np.array([g.size for g in gs], dtype=float)
    big_n = float(np.sum(n))
    df_e = big_n - k
    if df_e <= 0:
        raise ValueError("pooled methods need more observations than groups")
    mse = float(sum(np.sum((g - np.mean(g)) ** 2) for g in gs) / df_e)
    if mse <= 0.0:
        raise ValueError("within-group variance is zero; pooled comparisons are undefined")
    if method == "scheffe":
        crit = float(np.sqrt((k - 1) * sps.f.isf(alpha, k - 1, df_e)))
    elif method == "lsd":
        crit = float(sps.t.isf(alpha / 2.0, df_e))
    else:  # unreachable: tukey handled by the caller
        raise ValueError(method)
    rows = []
    for i in range(k):
        for j in range(i + 1, k):
            diff = float(np.mean(gs[i]) - np.mean(gs[j]))
            se = float(np.sqrt(mse * (1.0 / n[i] + 1.0 / n[j])))
            stat = diff / se
            if method == "scheffe":
                p = float(sps.f.sf(stat * stat / (k - 1), k - 1, df_e))
            else:
                p = float(2.0 * sps.t.sf(abs(stat), df_e))
            rows.append(
                {
                    "i": i,
                    "j": j,
                    "diff": diff,
                    "se": se,
                    "statistic": stat,
                    "df": float(df_e),
                    "p": p,
                    "ciLow": diff - crit * se,
                    "ciHigh": diff + crit * se,
                    "effect_size": diff / float(np.sqrt(mse)),
                    "significant": bool(p < alpha),
                }
            )
    return rows, mse


def _games_howell_rows(gs: list[NDArray[np.float64]], alpha: float) -> list[dict[str, Any]]:
    k = len(gs)
    var = _positive_variances(gs)
    rows = []
    for i in range(k):
        for j in range(i + 1, k):
            ni, nj = gs[i].size, gs[j].size
            vi, vj = var[i] / ni, var[j] / nj
            se = float(np.sqrt(vi + vj))
            diff = float(np.mean(gs[i]) - np.mean(gs[j]))
            df = float((vi + vj) ** 2 / (vi * vi / (ni - 1) + vj * vj / (nj - 1)))
            q = abs(diff) / se * np.sqrt(2.0)
            p = float(sps.studentized_range.sf(q, k, df))
            q_crit = float(sps.studentized_range.isf(alpha, k, df))
            half = q_crit / np.sqrt(2.0) * se
            rows.append(
                {
                    "i": i,
                    "j": j,
                    "diff": diff,
                    "se": se,
                    "statistic": diff / se,
                    "df": df,
                    "p": p,
                    "ciLow": diff - half,
                    "ciHigh": diff + half,
                    "effect_size": diff / float(np.sqrt((var[i] + var[j]) / 2.0)),
                    "significant": bool(p < alpha),
                }
            )
    return rows


def posthoc_pairwise(
    groups: list[NDArray[np.float64]], *, method: str = "games-howell", alpha: float = 0.05
) -> dict[str, Any]:
    """All-pairs mean comparisons. ``effect_size`` is Cohen's d: the mean
    difference over the pooled SD (``sqrt(MSE)``; Games-Howell: the pair's own
    ``sqrt((s_i^2+s_j^2)/2)``). ``lsd`` has NO multiplicity control: use it
    only after a significant omnibus test (reported as ``omnibus_p``)."""
    if method not in POSTHOC_METHODS:
        raise ValueError(f"method must be one of {POSTHOC_METHODS}, got {method!r}")
    _check_alpha(alpha)
    gs = _groups(groups)
    if method == "tukey":
        res = tukey_hsd(gs, alpha=alpha)
        df_e = sum(g.size for g in gs) - len(gs)
        mse = float(sum(np.sum((g - np.mean(g)) ** 2) for g in gs) / df_e)
        sd = float(np.sqrt(mse)) if mse > 0 else float("nan")
        rows = [{**r, "effect_size": r["diff"] / sd} for r in res["pairs"]]
    elif method == "games-howell":
        rows = _games_howell_rows(gs, alpha)
    else:
        rows, _ = _pooled_rows(gs, method, alpha)
    omnibus = sps.f_oneway(*gs)
    names = {
        "tukey": "Tukey HSD",
        "games-howell": "Games-Howell",
        "scheffe": "Scheffe",
        "lsd": "Fisher LSD",
    }
    return {
        "pairs": rows,
        "n_groups": len(gs),
        "alpha": alpha,
        "method": names[method],
        "key": method,
        "omnibus_p": float(omnibus.pvalue),
        "groups": [
            {"index": i, "n": int(g.size), "mean": float(np.mean(g))} for i, g in enumerate(gs)
        ],
        "adjusted": method != "lsd",
    }


def variance_test(
    groups: list[NDArray[np.float64]], *, method: str = "bartlett", alpha: float = 0.05
) -> dict[str, Any]:
    """Equal-variance tests. ``bartlett`` (normal data; NIST 1.3.5.7), the
    classic ``levene`` (mean-centred), ``brown-forsythe`` (median-centred,
    robust) and the two-sample ``f-test`` (ratio of variances, needs exactly
    two groups; two-sided p = 2 min(P(F<=f), P(F>=f)))."""
    if method not in VARIANCE_METHODS:
        raise ValueError(f"method must be one of {VARIANCE_METHODS}, got {method!r}")
    _check_alpha(alpha)
    gs = _groups(groups)
    sds = [
        {"index": i, "n": int(g.size), "variance": float(np.var(g, ddof=1))}
        for i, g in enumerate(gs)
    ]
    base: dict[str, Any] = {"alpha": alpha, "n_groups": len(gs), "groups": sds}
    if method == "bartlett":
        res = sps.bartlett(*gs)
        return {
            **base,
            "statistic": float(res.statistic),
            "statistic_name": "T",
            "df1": float(len(gs) - 1),
            "df2": None,
            "p": float(res.pvalue),
            "significant": bool(res.pvalue < alpha),
            "method": "Bartlett",
        }
    if method in ("levene", "brown-forsythe"):
        r = levene(gs, center="mean" if method == "levene" else "median")
        k, n_tot = len(gs), sum(g.size for g in gs)
        return {
            **base,
            "statistic": r["W"],
            "statistic_name": "W",
            "df1": float(k - 1),
            "df2": float(n_tot - k),
            "p": r["p"],
            "significant": bool(r["p"] < alpha),
            "method": r["method"],
        }
    if len(gs) != 2:
        raise ValueError("the F test compares exactly two groups; use Bartlett or Levene for more")
    v1, v2 = sds[0]["variance"], sds[1]["variance"]
    if v2 <= 0.0 or v1 <= 0.0:
        raise ValueError("a group has zero variance; the F test is undefined")
    d1, d2 = float(gs[0].size - 1), float(gs[1].size - 1)
    f = v1 / v2
    p = float(min(1.0, 2.0 * min(sps.f.cdf(f, d1, d2), sps.f.sf(f, d1, d2))))
    lo = f / float(sps.f.isf(alpha / 2.0, d1, d2))
    hi = f / float(sps.f.ppf(alpha / 2.0, d1, d2))
    return {
        **base,
        "statistic": float(f),
        "statistic_name": "F",
        "df1": d1,
        "df2": d2,
        "p": p,
        "ratio": float(f),
        "ratio_ci_low": lo,
        "ratio_ci_high": hi,
        "significant": bool(p < alpha),
        "method": "F test (two variances)",
    }
