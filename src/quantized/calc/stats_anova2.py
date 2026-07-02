"""Two-way ANOVA (balanced) + post-hoc tests (Tukey HSD, Dunnett).

ORIGIN_GAP_PLAN #24 core — scipy (BSD) only. The balanced factorial
closed form is validated in tests against the classic Montgomery
battery-life 3x3(n=4) worked example; post-hoc wraps scipy's exact
``tukey_hsd`` / ``dunnett`` (scipy >= 1.11, already the project floor).

Limitation (documented, tracked on the plan item): unbalanced designs
(Type II/III sums of squares) are not implemented here — the closed form
below requires an equal number of replicates per cell and raises otherwise.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats import _f_cdf

__all__ = ["anova2", "dunnett_test", "tukey_hsd"]


def anova2(cells: list[list[list[float]]], *, alpha: float = 0.05) -> dict[str, Any]:
    """Balanced two-way factorial ANOVA with interaction.

    ``cells[i][j]`` holds the n replicates of factor-A level i x factor-B
    level j (same n everywhere; n >= 2 for an interaction term, n == 1
    drops the interaction into the error — the classic additive model).
    Returns one row per source (A, B, AxB, Error, Total) with SS/df/MS/F/p.
    Reference: Montgomery, *Design and Analysis of Experiments*, ch. 5.
    """
    a = len(cells)
    b = len(cells[0]) if a else 0
    if a < 2 or b < 2:
        raise ValueError("anova2 needs at least 2 levels of each factor")
    if any(len(row) != b for row in cells):
        raise ValueError("every factor-A level needs the same factor-B levels")
    n = len(cells[0][0])
    if n < 1 or any(len(cell) != n for row in cells for cell in row):
        raise ValueError("anova2 requires a balanced design (equal replicates per cell)")

    y = np.asarray(cells, dtype=float)  # (a, b, n)
    if not np.all(np.isfinite(y)):
        raise ValueError("anova2 requires finite data (no NaN/Inf)")
    grand = float(y.mean())
    cell_means = y.mean(axis=2)  # (a, b)
    a_means = y.mean(axis=(1, 2))  # (a,)
    b_means = y.mean(axis=(0, 2))  # (b,)

    ss_a = float(n * b * np.sum((a_means - grand) ** 2))
    ss_b = float(n * a * np.sum((b_means - grand) ** 2))
    ss_ab = float(
        n * np.sum((cell_means - a_means[:, None] - b_means[None, :] + grand) ** 2)
    )
    ss_e = float(np.sum((y - cell_means[:, :, None]) ** 2))
    ss_t = float(np.sum((y - grand) ** 2))

    df_a, df_b, df_ab = a - 1, b - 1, (a - 1) * (b - 1)
    if n == 1:
        # No replicates: the interaction is not estimable — it becomes the error.
        ss_e, df_e = ss_ab, df_ab
        ss_ab, df_ab = 0.0, 0
    else:
        df_e = a * b * (n - 1)

    def _row(name: str, ss: float, df: int) -> dict[str, Any]:
        if df <= 0:
            return {"source": name, "SS": ss, "df": df, "MS": None, "F": None, "p": None}
        ms = ss / df
        if name in ("Error", "Total") or df_e <= 0:
            return {"source": name, "SS": ss, "df": df, "MS": ms, "F": None, "p": None}
        f = ms / (ss_e / df_e)
        return {
            "source": name, "SS": ss, "df": df, "MS": ms, "F": f,
            "p": 1.0 - _f_cdf(f, df, df_e),
        }

    rows = [_row("A", ss_a, df_a), _row("B", ss_b, df_b)]
    if df_ab > 0:
        rows.append(_row("AxB", ss_ab, df_ab))
    rows.append({"source": "Error", "SS": ss_e, "df": df_e,
                 "MS": ss_e / df_e if df_e else None, "F": None, "p": None})
    rows.append({"source": "Total", "SS": ss_t, "df": a * b * n - 1,
                 "MS": None, "F": None, "p": None})

    return {
        "table": rows,
        "a_levels": a,
        "b_levels": b,
        "replicates": n,
        "grand_mean": grand,
        "alpha": alpha,
        "interaction_estimable": n > 1,
    }


def _clean_groups(groups: list[NDArray[np.float64]], min_size: int) -> list[NDArray[np.float64]]:
    cleaned = []
    for g in groups:
        gv = np.asarray(g, dtype=float).ravel()
        gv = gv[np.isfinite(gv)]
        if gv.size < min_size:
            raise ValueError(f"every group needs at least {min_size} observations")
        cleaned.append(gv)
    return cleaned


def tukey_hsd(groups: list[NDArray[np.float64]], *, alpha: float = 0.05) -> dict[str, Any]:
    """Tukey's honestly-significant-difference test on k independent groups.

    All pairwise mean comparisons with familywise error control (exact
    studentized-range distribution via scipy). Returns one row per pair
    with the mean difference, p-value, and the (1-alpha) CI.
    """
    cleaned = _clean_groups(groups, 2)
    if len(cleaned) < 2:
        raise ValueError("tukey_hsd needs at least 2 groups")
    res = sps.tukey_hsd(*cleaned)
    ci = res.confidence_interval(confidence_level=1.0 - alpha)
    pairs = []
    for i in range(len(cleaned)):
        for j in range(i + 1, len(cleaned)):
            pairs.append({
                "i": i, "j": j,
                "diff": float(np.mean(cleaned[i]) - np.mean(cleaned[j])),
                "p": float(res.pvalue[i, j]),
                "ciLow": float(ci.low[i, j]),
                "ciHigh": float(ci.high[i, j]),
                "significant": bool(res.pvalue[i, j] < alpha),
            })
    return {"pairs": pairs, "n_groups": len(cleaned), "alpha": alpha, "method": "Tukey HSD"}


def dunnett_test(
    groups: list[NDArray[np.float64]],
    *,
    control: int = 0,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """Dunnett's many-to-one test: every group vs the control group.

    Familywise error control for treatment-vs-control designs (exact
    multivariate-t via scipy >= 1.11). ``control`` indexes into ``groups``.
    """
    cleaned = _clean_groups(groups, 2)
    if len(cleaned) < 2:
        raise ValueError("dunnett_test needs a control and at least 1 treatment")
    if not 0 <= control < len(cleaned):
        raise ValueError(f"control index {control} out of range")
    ctrl = cleaned[control]
    treatments = [g for k, g in enumerate(cleaned) if k != control]
    idx = [k for k in range(len(cleaned)) if k != control]
    res = sps.dunnett(*treatments, control=ctrl, alternative=alternative)
    ci = res.confidence_interval(confidence_level=1.0 - alpha)
    rows = []
    for pos, k in enumerate(idx):
        rows.append({
            "group": k,
            "diff": float(np.mean(cleaned[k]) - np.mean(ctrl)),
            "statistic": float(res.statistic[pos]),
            "p": float(res.pvalue[pos]),
            "ciLow": float(ci.low[pos]),
            "ciHigh": float(ci.high[pos]),
            "significant": bool(res.pvalue[pos] < alpha),
        })
    return {
        "comparisons": rows, "control": control, "alpha": alpha,
        "alternative": alternative, "method": "Dunnett",
    }
