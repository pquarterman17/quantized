"""Extended ANOVA: repeated-measures (within-subjects) + unbalanced factorial.

ORIGIN_GAP_PLAN #24 remainder. numpy/scipy only (BSD) — no statsmodels dep.

- ``repeated_measures_anova`` — one-way within-subjects ANOVA over a
  (subjects x conditions) matrix, partitioning out the between-subjects
  variance so the condition effect is tested against the subject-by-
  condition residual. Greenhouse-Geisser and Huynh-Feldt sphericity
  corrections are reported alongside the uncorrected test.

- ``anova2_unbalanced`` — two-way factorial for *unequal* cell counts,
  with Type II or Type III sums of squares computed by the nested-model
  regression definition over effect-coded (sum-to-zero) design matrices,
  which is what makes Type III well-defined and matches SAS / statsmodels.
  On a *balanced* design all SS types coincide and equal the closed-form
  ``stats_anova2.anova2`` — the tests anchor on that exact equivalence.

- ``long_to_groups`` / ``long_to_cells`` — reshape a worksheet value
  column plus one or two factor (label) columns into the structures the
  ANOVA functions expect.

References: Montgomery, *Design and Analysis of Experiments*; Maxwell &
Delaney, *Designing Experiments and Analyzing Data* (within-subjects &
Type II/III SS).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats import _f_cdf

__all__ = [
    "anova2_unbalanced",
    "long_to_cells",
    "long_to_groups",
    "repeated_measures_anova",
]


# --------------------------------------------------------------------------
# Repeated-measures (within-subjects) one-way ANOVA
# --------------------------------------------------------------------------
def _sphericity_epsilons(y: NDArray[np.float64], n: int, k: int) -> dict[str, float]:
    """Greenhouse-Geisser and Huynh-Feldt epsilon from the condition covariance.

    Transform the k conditions by a (k-1)-row orthonormal contrast matrix,
    take the covariance ``T`` of those contrasts across subjects, and use its
    eigenvalues: eps_GG = (sum lambda)^2 / ((k-1) sum lambda^2). Huynh-Feldt
    inflates GG, clipped at 1. Both live in [1/(k-1), 1].
    """
    # Orthonormal basis for the (k-1)-dim space orthogonal to the ones vector.
    contrasts, _ = np.linalg.qr(
        np.column_stack([np.ones(k), np.eye(k)[:, : k - 1]])
    )
    c = np.asarray(contrasts[:, 1:k].T, dtype=float)  # (k-1, k), rows _|_ ones
    # Covariance of the conditions across subjects (rows = subjects).
    cov = np.asarray(np.cov(y, rowvar=False, ddof=1), dtype=float)
    t = np.asarray(c @ cov @ c.T, dtype=float)
    lam = np.asarray(np.linalg.eigvalsh(t), dtype=float)
    lam = lam[lam > 0]
    if lam.size == 0:
        return {"gg": 1.0, "hf": 1.0}
    eps_gg = float(lam.sum() ** 2 / ((k - 1) * np.sum(lam**2)))
    eps_gg = min(1.0, max(1.0 / (k - 1), eps_gg))
    num = n * (k - 1) * eps_gg - 2.0
    den = (k - 1) * ((n - 1) - (k - 1) * eps_gg)
    eps_hf = 1.0 if den == 0 else min(1.0, num / den)
    return {"gg": eps_gg, "hf": max(eps_gg, eps_hf)}


def repeated_measures_anova(
    data: list[list[float]] | NDArray[np.float64], *, alpha: float = 0.05
) -> dict[str, Any]:
    """One-way repeated-measures ANOVA on a (subjects x conditions) matrix.

    Every subject (row) is measured under every condition (column). The
    condition effect is tested against the subject x condition residual::

        SS_total      = sum (x - grand)^2
        SS_subjects   = k * sum (subject_mean - grand)^2
        SS_conditions = n * sum (condition_mean - grand)^2
        SS_error      = SS_total - SS_subjects - SS_conditions

    with df_conditions = k-1 and df_error = (k-1)(n-1). Returns the ANOVA
    table plus Greenhouse-Geisser / Huynh-Feldt corrected p-values (the
    honest choice when compound symmetry is doubtful).
    """
    y = np.asarray(data, dtype=float)
    if y.ndim != 2 or y.shape[0] < 2 or y.shape[1] < 2:
        raise ValueError("need a subjects x conditions matrix with >=2 subjects and >=2 conditions")
    if not np.all(np.isfinite(y)):
        raise ValueError("repeated_measures_anova requires finite data (no NaN/Inf)")
    n, k = int(y.shape[0]), int(y.shape[1])

    grand = float(y.mean())
    subj_means = np.asarray(y.mean(axis=1), dtype=float)
    cond_means = np.asarray(y.mean(axis=0), dtype=float)
    ss_total = float(np.sum((y - grand) ** 2))
    ss_subjects = float(k * np.sum((subj_means - grand) ** 2))
    ss_conditions = float(n * np.sum((cond_means - grand) ** 2))
    ss_error = ss_total - ss_subjects - ss_conditions

    df_cond, df_subj, df_err = k - 1, n - 1, (k - 1) * (n - 1)
    ms_cond = ss_conditions / df_cond
    ms_err = ss_error / df_err if df_err > 0 else float("nan")
    f = ms_cond / ms_err if ms_err > 0 else float("inf")
    p = 1.0 - _f_cdf(f, df_cond, df_err)

    eps = _sphericity_epsilons(y, n, k)
    p_gg = 1.0 - _f_cdf(f, df_cond * eps["gg"], df_err * eps["gg"])
    p_hf = 1.0 - _f_cdf(f, df_cond * eps["hf"], df_err * eps["hf"])

    table = [
        {"source": "Subjects", "SS": ss_subjects, "df": df_subj,
         "MS": ss_subjects / df_subj, "F": None, "p": None},
        {"source": "Conditions", "SS": ss_conditions, "df": df_cond,
         "MS": ms_cond, "F": f, "p": p},
        {"source": "Error", "SS": ss_error, "df": df_err, "MS": ms_err,
         "F": None, "p": None},
        {"source": "Total", "SS": ss_total, "df": n * k - 1, "MS": None,
         "F": None, "p": None},
    ]
    # partial eta-squared for the condition effect
    eta_p = ss_conditions / (ss_conditions + ss_error) if (ss_conditions + ss_error) > 0 else 0.0
    return {
        "table": table,
        "n_subjects": n,
        "n_conditions": k,
        "grand_mean": grand,
        "alpha": alpha,
        "partial_eta_sq": eta_p,
        "sphericity": {
            "greenhouse_geisser": eps["gg"],
            "huynh_feldt": eps["hf"],
            "p_greenhouse_geisser": p_gg,
            "p_huynh_feldt": p_hf,
        },
    }


# --------------------------------------------------------------------------
# Unbalanced two-way factorial ANOVA (Type II / Type III SS)
# --------------------------------------------------------------------------
def _effect_code(codes: NDArray[np.intp], n_levels: int) -> NDArray[np.float64]:
    """Sum-to-zero (deviation) coding: (N, n_levels-1) columns.

    Level j<last -> +1 in column j; the last level -> -1 in every column;
    all other rows 0. Orthogonal for balanced data, which is what lets the
    Type III drop-one-term contrast reduce to the classic SS there.
    """
    n = codes.size
    x = np.zeros((n, n_levels - 1), dtype=float)
    for j in range(n_levels - 1):
        x[codes == j, j] = 1.0
    x[codes == n_levels - 1, :] = -1.0
    return x


def _sse(design: NDArray[np.float64], y: NDArray[np.float64]) -> float:
    """Residual sum of squares of an OLS fit (least squares, rank-safe)."""
    beta, _, _, _ = np.linalg.lstsq(design, y, rcond=None)
    resid = np.asarray(y - design @ beta, dtype=float)
    return float(resid @ resid)


def anova2_unbalanced(
    values: NDArray[np.float64],
    factor_a: list[Any] | NDArray[Any],
    factor_b: list[Any] | NDArray[Any],
    *,
    ss_type: int = 3,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Two-way factorial ANOVA for unbalanced (unequal-n) designs.

    ``values`` are the observations; ``factor_a`` / ``factor_b`` are the
    matching factor labels (any hashable). Sums of squares:

    - ``ss_type=3`` (default): each term's SS = the increase in residual SS
      when its effect-coded columns are dropped from the *full* model
      (which keeps all other terms). Requires every A x B cell to be
      non-empty; matches SAS / statsmodels Type III.
    - ``ss_type=2``: main effects adjusted for each other but ignoring the
      interaction (``SS(A | B)``, ``SS(B | A)``); the interaction term is
      the same as Type III.

    On a balanced design all SS types equal the closed-form
    :func:`quantized.calc.stats_anova2.anova2`.
    """
    if ss_type not in (2, 3):
        raise ValueError("ss_type must be 2 or 3")
    y = np.asarray(values, dtype=float).ravel()
    fa = np.asarray(list(factor_a), dtype=object).ravel()
    fb = np.asarray(list(factor_b), dtype=object).ravel()
    if not (y.size == fa.size == fb.size):
        raise ValueError("values, factor_a, factor_b must have the same length")
    finite = np.isfinite(y)
    y, fa, fb = y[finite], fa[finite], fb[finite]
    if y.size < 4:
        raise ValueError("anova2_unbalanced needs at least 4 finite observations")

    a_levels = sorted({str(v) for v in fa})
    b_levels = sorted({str(v) for v in fb})
    a, b = len(a_levels), len(b_levels)
    if a < 2 or b < 2:
        raise ValueError("anova2_unbalanced needs at least 2 levels of each factor")
    a_idx = np.array([a_levels.index(str(v)) for v in fa], dtype=np.intp)
    b_idx = np.array([b_levels.index(str(v)) for v in fb], dtype=np.intp)

    # every cell must be populated (Type III is undefined with an empty cell)
    counts = np.zeros((a, b), dtype=int)
    for ia, ib in zip(a_idx, b_idx, strict=True):
        counts[ia, ib] += 1
    if np.any(counts == 0):
        raise ValueError("anova2_unbalanced requires at least one observation in every A x B cell")

    n_obs = y.size
    intercept = np.ones((n_obs, 1), dtype=float)
    a_cols = _effect_code(a_idx, a)  # (N, a-1)
    b_cols = _effect_code(b_idx, b)  # (N, b-1)
    ab_cols = np.asarray(  # (N, (a-1)(b-1)) products of the two codings
        np.hstack([a_cols[:, [i]] * b_cols for i in range(a - 1)]), dtype=float
    ) if (a - 1) and (b - 1) else np.zeros((n_obs, 0), dtype=float)

    full = np.hstack([intercept, a_cols, b_cols, ab_cols])
    sse_full = _sse(full, y)
    df_e = n_obs - (a * b)
    if df_e <= 0:
        raise ValueError("not enough observations to estimate the error term")

    no_a = np.hstack([intercept, b_cols, ab_cols])
    no_b = np.hstack([intercept, a_cols, ab_cols])
    no_ab = np.hstack([intercept, a_cols, b_cols])

    ss_ab = _sse(no_ab, y) - sse_full  # identical for Type II and III
    if ss_type == 3:
        ss_a = _sse(no_a, y) - sse_full
        ss_b = _sse(no_b, y) - sse_full
    else:  # Type II: main effect adjusted for the other main effect only
        base = intercept
        sse_b_only = _sse(np.hstack([base, b_cols]), y)
        sse_a_only = _sse(np.hstack([base, a_cols]), y)
        sse_a_and_b = _sse(no_ab, y)
        ss_a = sse_b_only - sse_a_and_b
        ss_b = sse_a_only - sse_a_and_b

    df_a, df_b, df_ab = a - 1, b - 1, (a - 1) * (b - 1)
    ms_e = sse_full / df_e

    def _row(name: str, ss: float, df: int) -> dict[str, Any]:
        ss = max(0.0, ss)
        ms = ss / df
        f = ms / ms_e
        return {"source": name, "SS": ss, "df": df, "MS": ms, "F": f,
                "p": 1.0 - _f_cdf(f, df, df_e)}

    ss_t = float(np.sum((y - y.mean()) ** 2))
    table = [
        _row("A", ss_a, df_a),
        _row("B", ss_b, df_b),
        _row("AxB", ss_ab, df_ab),
        {"source": "Error", "SS": sse_full, "df": df_e, "MS": ms_e, "F": None, "p": None},
        {"source": "Total", "SS": ss_t, "df": n_obs - 1, "MS": None, "F": None, "p": None},
    ]
    return {
        "table": table,
        "ss_type": ss_type,
        "a_levels": a_levels,
        "b_levels": b_levels,
        "cell_counts": counts.tolist(),
        "balanced": bool(np.all(counts == counts.flat[0])),
        "n_obs": int(n_obs),
        "alpha": alpha,
    }


# --------------------------------------------------------------------------
# Long-format reshapers (worksheet value + factor columns -> ANOVA inputs)
# --------------------------------------------------------------------------
def long_to_groups(
    values: NDArray[np.float64], factor: list[Any] | NDArray[Any]
) -> dict[str, Any]:
    """Split a value column into per-level groups by a factor (label) column.

    Returns ``{"levels": [...], "groups": [ndarray, ...]}`` (levels sorted
    for determinism, non-finite values dropped) — the shape the k-sample
    tests (one-way ANOVA, Kruskal-Wallis, ...) consume.
    """
    v = np.asarray(values, dtype=float).ravel()
    f = np.asarray(list(factor), dtype=object).ravel()
    if v.size != f.size:
        raise ValueError("values and factor must have the same length")
    levels = sorted({str(x) for x in f})
    groups = []
    for lev in levels:
        g = v[np.array([str(x) == lev for x in f])]
        groups.append(np.asarray(g[np.isfinite(g)], dtype=float))
    return {"levels": levels, "groups": groups}


def long_to_cells(
    values: NDArray[np.float64],
    factor_a: list[Any] | NDArray[Any],
    factor_b: list[Any] | NDArray[Any],
) -> dict[str, Any]:
    """Reshape long-format value + two factor columns into a cell grid.

    Returns ``a_levels``, ``b_levels``, and ``cells`` (``cells[i][j]`` is the
    list of observations for A-level i x B-level j). When every cell holds
    the same count, ``cells`` is directly usable by
    :func:`quantized.calc.stats_anova2.anova2`; otherwise route the long
    columns straight to :func:`anova2_unbalanced`.
    """
    v = np.asarray(values, dtype=float).ravel()
    fa = np.asarray(list(factor_a), dtype=object).ravel()
    fb = np.asarray(list(factor_b), dtype=object).ravel()
    if not (v.size == fa.size == fb.size):
        raise ValueError("values, factor_a, factor_b must have the same length")
    a_levels = sorted({str(x) for x in fa})
    b_levels = sorted({str(x) for x in fb})
    cells: list[list[list[float]]] = [[[] for _ in b_levels] for _ in a_levels]
    for val, la, lb in zip(v, fa, fb, strict=True):
        if not np.isfinite(val):
            continue
        cells[a_levels.index(str(la))][b_levels.index(str(lb))].append(float(val))
    counts = [[len(c) for c in row] for row in cells]
    flat = [n for row in counts for n in row]
    return {
        "a_levels": a_levels,
        "b_levels": b_levels,
        "cells": cells,
        "cell_counts": counts,
        "balanced": bool(flat) and all(n == flat[0] and n > 0 for n in flat),
    }
