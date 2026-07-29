"""Two-level nested (hierarchical) ANOVA + ANOVA-method variance components.

JMP_GAP_PLAN J8 backend half — feeds the "variability chart" workshop
(nested factor axis, cell points, connect-cell-means, group-mean lines).
numpy/scipy only (BSD), no statsmodels dep — mirrors ``stats_anova2`` /
``stats_anova_ext``.

Model (Montgomery, *Design and Analysis of Experiments*, ch. 14; Sokal &
Rohlf, *Biometry*, ch. 10 — "nested" == "hierarchical" ANOVA)::

    y_ijk = mu + A_i + B_ij + e_ijk
    i = 1..a (factor A level), j = 1..b_i (factor B level, NESTED in A_i,
    not crossed -- b_i may differ across i), k = 1..n_ijk (replicate)

B is nested in A (each batch belongs to exactly one supplier; "batch 1 of
supplier 1" and "batch 1 of supplier 2" are unrelated), unlike the crossed
two-way design in ``stats_anova2.anova2`` where every B level appears under
every A level. That is what makes the SS decomposition below unambiguous
even when unbalanced (there is no A x B interaction term to define).

Data contract
-------------
Every public function takes ``groups: Sequence[Sequence[Sequence[float]]]``
-- ``groups[i]`` is factor-A level i's list of B-subgroups, and
``groups[i][j]`` is the sequence of replicate observations in that (A=i,
B=j) cell. This directly encodes the hierarchy (a nested *dict* keyed by
label would need a second contract for level ordering/serialization to
JSON, so the plain nested-list shape wins for the wire format; the caller
supplies labels/levels separately if it has string factor levels).
Non-finite observations are dropped; every cell needs >=1 finite value.
Unbalanced designs (different b_i across A, different n per cell) are
supported throughout; a per-function ``balanced`` flag reports whether the
classic closed-form estimators are exact for that input.

Sums of squares (unbalanced-safe, direct group/cell means -- Montgomery
14.7 "unequal replication", Sokal & Rohlf 10.4)::

    SS_A     = sum_i N_i (ybar_i.. - ybar...)^2            df_A   = a - 1
    SS_B(A)  = sum_i sum_j n_ij (ybar_ij. - ybar_i..)^2     df_B(A)= sum_i(b_i - 1)
    SS_Error = sum_i sum_j sum_k (y_ijk - ybar_ij.)^2       df_E   = N - sum_i(b_i)
    SS_Total = sum (y_ijk - ybar...)^2  = SS_A + SS_B(A) + SS_Error

EMS (mixed model, A fixed or random -- the nested-design F-tests are the
same either way, Montgomery Table 14.3): A is tested against B(A); B(A) is
tested against Error.

Variance components (ANOVA/EMS method): solving the balanced-case EMS
equations::

    E[MS_Error] = sigma_e^2
    E[MS_B(A)]  = sigma_e^2 + n * sigma_B^2
    E[MS_A]     = sigma_e^2 + n * sigma_B^2 + n*b * sigma_A^2

for equal b_i = b, equal n_ij = n gives the textbook closed form. For
unbalanced data we use the standard Satterthwaite-style average-coefficient
generalization (a documented approximation, not the exact unbiased
quadratic-form coefficients of Searle et al., *Variance Components*, 1992 --
those require the full unbalanced covariance algebra and are not
implemented here):

    n1 = (N - sum_i sum_j n_ij^2 / N_i) / df_B(A)   -- coefficient of
         sigma_B^2 in E[MS_B(A)]; this one IS exact in general (derived
         below), it reduces to n in the balanced case.
    n2 = (N - sum_i N_i^2 / N) / df_A               -- coefficient of
         sigma_A^2 in E[MS_A], using n1 as a stand-in for the coefficient
         of sigma_B^2 in E[MS_A] too (exact only when balanced, where
         n2 reduces to n*b); this is the "unweighted means" approximation.

Exactness of n1 (sketch): write ybar_ij. = mu + A_i + B_ij + ebar_ij.  Then
SS_B(A) partitions per A-level i into a between-B-level piece (expectation
sigma_B^2 (N_i - sum_j n_ij^2/N_i)) plus a pure-error piece (expectation
sigma_e^2 (b_i - 1), by the same "weighted one-way ANOVA" identity used for
SS_Error/SS_A). Summing over i and dividing by df_B(A) = sum_i(b_i-1) gives
n1 above -- no balance assumption needed.

Negative variance estimates are common with real data (MS_B(A) can be
smaller than MS_Error by chance) and are clamped to 0 (standard practice,
e.g. Montgomery 14.3-style discussion); the ``clamped`` flags in
``variance_components_nested`` say when that fired, and the *_raw fields
keep the signed value for diagnostics.

Reference source used to validate this module: Montgomery / Sokal & Rohlf's
published *method* (the SS/EMS formulas above, which are unambiguous and
widely reproduced); the network was not reachable from this environment to
pull the exact digit-for-digit textbook data table, so ``tests/
test_calc_stats_varcomp.py`` pins against a small hand-constructed dataset
with every SS/df/MS/F/sigma^2 value re-derived from the formulas above in
the test comments (auditable arithmetic), plus a balanced-vs-EMS
cross-check and a from-scratch two-way-decomposition identity check
(SS_A + SS_B(A) + SS_Error == SS_Total exactly). See the module docstring
above and the test file header for the full derivation trail.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats import _f_cdf

__all__ = ["nested_anova", "variability_summary", "variance_components_nested"]

NestedGroups = Sequence[Sequence[Sequence[float]]]


def _prepare(groups: NestedGroups) -> list[list[NDArray[np.float64]]]:
    """Validate + clean a nested-groups input into ``cells[i][j]`` ndarrays."""
    a = len(groups)
    if a < 2:
        raise ValueError("nested design needs at least 2 levels of factor A")
    cells: list[list[NDArray[np.float64]]] = []
    for i, sub in enumerate(groups):
        if len(sub) < 1:
            raise ValueError(f"factor-A level {i} has no B-subgroups")
        row: list[NDArray[np.float64]] = []
        for j, obs in enumerate(sub):
            arr = np.asarray(obs, dtype=float).ravel()
            arr = arr[np.isfinite(arr)]
            if arr.size < 1:
                raise ValueError(f"cell (A={i}, B={j}) has no finite observations")
            row.append(arr)
        cells.append(row)
    return cells


def _nested_stats(cells: list[list[NDArray[np.float64]]]) -> dict[str, Any]:
    """SS/df decomposition + group/cell means shared by all three public functions."""
    a = len(cells)
    b_i = [len(row) for row in cells]
    n_ij = [[int(c.size) for c in row] for row in cells]
    n_i = [sum(row) for row in n_ij]
    n_total = sum(n_i)
    all_obs = np.concatenate([c for row in cells for c in row])
    grand = float(all_obs.mean())

    cell_means = [[float(c.mean()) for c in row] for row in cells]
    a_means = [float(np.concatenate(row).mean()) for row in cells]

    ss_a = float(sum(n_i[i] * (a_means[i] - grand) ** 2 for i in range(a)))
    ss_b = float(
        sum(
            n_ij[i][j] * (cell_means[i][j] - a_means[i]) ** 2
            for i in range(a)
            for j in range(b_i[i])
        )
    )
    ss_e = float(
        sum(
            float(np.sum((cells[i][j] - cell_means[i][j]) ** 2))
            for i in range(a)
            for j in range(b_i[i])
        )
    )
    ss_t = float(np.sum((all_obs - grand) ** 2))

    sum_b = sum(b_i)
    df_a, df_b, df_e, df_t = a - 1, sum_b - a, n_total - sum_b, n_total - 1

    return {
        "a": a, "b_i": b_i, "n_ij": n_ij, "n_i": n_i, "n_total": n_total,
        "sum_b": sum_b, "grand": grand, "cell_means": cell_means, "a_means": a_means,
        "ss_a": ss_a, "ss_b": ss_b, "ss_e": ss_e, "ss_t": ss_t,
        "df_a": df_a, "df_b": df_b, "df_e": df_e, "df_t": df_t,
    }


def _is_balanced(st: dict[str, Any]) -> bool:
    b_i = st["b_i"]
    if len(set(b_i)) > 1:
        return False
    flat_n = [n for row in st["n_ij"] for n in row]
    return len(set(flat_n)) <= 1


def nested_anova(groups: NestedGroups, *, alpha: float = 0.05) -> dict[str, Any]:
    """Fully nested (hierarchical) two-level ANOVA, balanced or unbalanced.

    ``groups[i][j]`` = replicate observations for factor-A level i, factor-B
    (nested-in-A) level j -- see the module docstring for the data contract
    and the SS formulas. A is tested against B(A) (``F_A = MS_A/MS_B(A)``);
    B(A) is tested against Error (``F_B(A) = MS_B(A)/MS_Error``). If B(A) is
    not estimable (every A level has exactly one B-subgroup, ``df_B(A)==0``)
    A is tested against Error directly instead, and
    ``b_within_a_estimable`` / ``a_tested_against`` say so.
    """
    cells = _prepare(groups)
    st = _nested_stats(cells)
    df_a, df_b, df_e, df_t = st["df_a"], st["df_b"], st["df_e"], st["df_t"]
    ss_a, ss_b, ss_e, ss_t = st["ss_a"], st["ss_b"], st["ss_e"], st["ss_t"]

    ms_a: float | None = ss_a / df_a if df_a > 0 else None
    ms_b: float | None = ss_b / df_b if df_b > 0 else None
    ms_e: float | None = ss_e / df_e if df_e > 0 else None

    b_estimable = df_b > 0
    denom_ms = ms_b if b_estimable else ms_e
    denom_df = df_b if b_estimable else df_e
    tested_against = "B(A)" if b_estimable else "Error"

    f_a = p_a = None
    if ms_a is not None and denom_ms is not None and denom_ms > 0 and denom_df > 0:
        f_a = ms_a / denom_ms
        p_a = 1.0 - _f_cdf(f_a, df_a, denom_df)

    f_b = p_b = None
    if ms_b is not None and ms_e is not None and ms_e > 0 and df_e > 0:
        f_b = ms_b / ms_e
        p_b = 1.0 - _f_cdf(f_b, df_b, df_e)

    table = [
        {"source": "A", "SS": ss_a, "df": df_a, "MS": ms_a, "F": f_a, "p": p_a},
        {"source": "B(A)", "SS": ss_b, "df": df_b, "MS": ms_b, "F": f_b, "p": p_b},
        {"source": "Error", "SS": ss_e, "df": df_e, "MS": ms_e, "F": None, "p": None},
        {"source": "Total", "SS": ss_t, "df": df_t, "MS": None, "F": None, "p": None},
    ]
    return {
        "table": table,
        "a_levels": st["a"],
        "b_per_a": st["b_i"],
        "n_per_cell": st["n_ij"],
        "n_total": st["n_total"],
        "grand_mean": st["grand"],
        "alpha": alpha,
        "a_tested_against": tested_against,
        "b_within_a_estimable": b_estimable,
        "error_estimable": df_e > 0,
        "balanced": _is_balanced(st),
    }


def variance_components_nested(groups: NestedGroups) -> dict[str, Any]:
    """ANOVA/EMS-method variance-component estimates for a 2-level nested design.

    Exact closed form when ``groups`` is balanced (equal B-subgroups per A
    level, equal replicates per cell); the standard Satterthwaite-style
    average-coefficient (``n0``) generalization otherwise, per the module
    docstring -- ``method`` in the result says which. Requires B(A) and
    Error both estimable (``df_B(A) > 0`` and ``df_Error > 0``); negative
    raw estimates clamp to 0 with the ``clamped`` flags set.
    """
    cells = _prepare(groups)
    st = _nested_stats(cells)
    a, n_total = st["a"], st["n_total"]
    df_a, df_b, df_e = st["df_a"], st["df_b"], st["df_e"]
    if df_b <= 0:
        raise ValueError(
            "variance_components_nested needs at least one factor-A level "
            "with >=2 B-subgroups (B(A) must be estimable)"
        )
    if df_e <= 0:
        raise ValueError(
            "variance_components_nested needs at least one cell with >=2 "
            "replicates to estimate the error variance"
        )

    ms_a = st["ss_a"] / df_a
    ms_b = st["ss_b"] / df_b
    ms_e = st["ss_e"] / df_e

    m_i = [
        sum(nij * nij for nij in st["n_ij"][i]) / st["n_i"][i] for i in range(a)
    ]
    n1 = (n_total - sum(m_i)) / df_b  # exact coefficient of sigma_B^2 in E[MS_B(A)]
    n2 = (
        n_total - sum(ni * ni for ni in st["n_i"]) / n_total
    ) / df_a  # coefficient of sigma_A^2 in E[MS_A] (exact iff balanced)

    sigma2_e_raw = ms_e
    sigma2_b_raw = (ms_b - ms_e) / n1
    sigma2_a_raw = (ms_a - ms_b) / n2

    sigma2_e = max(sigma2_e_raw, 0.0)
    sigma2_b = max(sigma2_b_raw, 0.0)
    sigma2_a = max(sigma2_a_raw, 0.0)
    clamped = {
        "A": sigma2_a_raw < 0.0,
        "B_within_A": sigma2_b_raw < 0.0,
        "error": sigma2_e_raw < 0.0,
    }

    total = sigma2_a + sigma2_b + sigma2_e

    def _pct(x: float) -> float:
        return x / total * 100.0 if total > 0 else 0.0

    balanced = _is_balanced(st)
    return {
        "sigma2_A": sigma2_a,
        "sigma2_B_within_A": sigma2_b,
        "sigma2_error": sigma2_e,
        "sigma2_A_raw": sigma2_a_raw,
        "sigma2_B_within_A_raw": sigma2_b_raw,
        "sigma2_error_raw": sigma2_e_raw,
        "pct_A": _pct(sigma2_a),
        "pct_B_within_A": _pct(sigma2_b),
        "pct_error": _pct(sigma2_e),
        "clamped": clamped,
        "n1_coefficient": n1,
        "n2_coefficient": n2,
        "ms_a": ms_a,
        "ms_b": ms_b,
        "ms_e": ms_e,
        "balanced": balanced,
        "method": (
            "ANOVA/EMS method (exact closed form, balanced design)"
            if balanced
            else "ANOVA/EMS method, Satterthwaite-style average coefficients "
            "(n0/unweighted-means approximation) for unbalanced data"
        ),
    }


def variability_summary(groups: NestedGroups) -> dict[str, Any]:
    """Per-cell + per-A-group + grand summary stats for the variability chart.

    This is the single data contract the variability-chart UI draws from:
    one row per (A, B) cell with n/mean/sd (sample sd, ddof=1; ``None`` for
    n==1 cells), one row per A-level with its n/mean (for the "group mean"
    line), and the grand mean/n (for the reference line across the whole
    chart).
    """
    cells = _prepare(groups)
    st = _nested_stats(cells)
    a = st["a"]

    cell_rows = []
    for i in range(a):
        for j in range(st["b_i"][i]):
            c = cells[i][j]
            sd = float(c.std(ddof=1)) if c.size > 1 else None
            cell_rows.append(
                {
                    "a_index": i,
                    "b_index": j,
                    "n": int(c.size),
                    "mean": float(c.mean()),
                    "sd": sd,
                }
            )

    a_rows = [
        {"a_index": i, "n": st["n_i"][i], "mean": st["a_means"][i]} for i in range(a)
    ]

    return {
        "cells": cell_rows,
        "a_groups": a_rows,
        "grand_mean": st["grand"],
        "grand_n": st["n_total"],
        "a_levels": a,
        "balanced": _is_balanced(st),
    }
