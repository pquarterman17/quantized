"""Fit Model: all-pairs comparisons of least-squares means (GAP_AUDIT_9 G1 follow-up).

For one categorical effect (a term whose factors are all nominal) every pair of
its LS-means cells (levels, or level combinations for a crossed effect) is
compared with the contrast ``d = (l_i - l_j) beta`` where ``l`` is the row of
the design matrix at the LS-means neutral profile (the same row
:mod:`quantized.calc.stats_linear_model` uses for the LS-means table). Its
variance comes from the fit's coefficient covariance (``MSE * (X'X)^-1``, stored
in the model description), so ``se = sqrt((l_i - l_j) V (l_i - l_j)')`` and
``t = d / se`` on ``df_error`` degrees of freedom. Pure numpy/scipy; the model is
the plain-JSON ``fit_linear_model(...)["model"]``, so no data and no refit.

Methods (JMP *Multiple Comparisons* in the Effect Details report,
https://www.jmp.com/support/help/en/18.1/jmp/effect-details.shtml, and the
Statistics Knowledge Portal "Multiple comparisons"):

* ``student`` - Student's t, **unadjusted** (each pair at ``alpha``; JMP's "Each
  Pair, Student's t"). Does not control the family-wise error rate.
* ``tukey`` - Tukey HSD / Tukey-Kramer (JMP "All Pairs, Tukey HSD"). With ``k``
  cells the studentized range ``q = sqrt(2) |t|`` is referred to
  ``scipy.stats.studentized_range(k, df_error)``; the interval half-width is
  ``q_crit / sqrt(2) * se``. For unbalanced cells this is the Tukey-Kramer
  procedure (conservative); for a one-way balanced layout it is exactly Tukey's
  HSD. Tukey, "The problem of multiple comparisons" (1953); Kramer, Biometrics
  12 (1956) 307-310.
* ``bonferroni`` - the unadjusted p times the number of pairs (capped at 1),
  intervals at ``alpha / m``.

Refusals (``ValueError`` -> HTTP 422): an effect not in the model, an effect with
a continuous factor (its LS means are not defined), fewer than 2 cells, an
unknown method, and a malformed model.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_lm_design import (
    AVERAGE_LEVEL,
    CONTINUOUS,
    NOMINAL,
    ModelSpec,
    design_matrix,
    spec_from_dict,
    term_key,
    term_label,
)

METHODS = ("tukey", "student", "bonferroni")
#: Beyond this many cells the all-pairs table is refused (k*(k-1)/2 rows; Tukey p values are
#: numerical integrals, ~1 s at 30 cells).
MAX_CELLS = 40


def _none(v: float) -> float | None:
    return v if math.isfinite(v) else None


def lsmean_rows(
    spec: ModelSpec, term: Sequence[str]
) -> tuple[list[tuple[int, ...]], NDArray[np.float64]]:
    """The cells of an all-nominal ``term`` and one design row per cell, at the
    LS-means neutral profile (continuous at its mean, other nominal averaged)."""
    level_lists = [range(len(spec.factor(nm).levels)) for nm in term]
    combos = list(itertools.product(*level_lists))
    m = len(combos)
    prof: dict[str, NDArray[np.float64]] = {}
    for f in spec.factors:
        prof[f.name] = np.full(m, f.mean if f.kind == CONTINUOUS else float(AVERAGE_LEVEL))
    for i, nm in enumerate(term):
        prof[nm] = np.asarray([c[i] for c in combos], dtype=float)
    return combos, design_matrix(spec, prof, m)


def compare_ls_means(
    model: Mapping[str, Any],
    effect: Sequence[str],
    *,
    method: str = "tukey",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """All-pairs LS-means comparisons for ``effect`` (a list of factor names)."""
    if method not in METHODS:
        raise ValueError(f"method must be one of {', '.join(METHODS)}")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    spec = spec_from_dict(model)
    wanted = term_key([str(n) for n in effect])
    term = next((t for t in spec.terms if term_key(t) == wanted), None)
    if term is None:
        raise ValueError(f"effect {'*'.join(effect)!r} is not a term of the model")
    if any(spec.factor(nm).kind != NOMINAL for nm in term):
        raise ValueError(
            f"effect {term_label(term)!r} involves a continuous factor; "
            "comparisons are for categorical effects"
        )
    beta = np.asarray(model["coefficients"], dtype=float)
    cov = np.asarray(model["covariance"], dtype=float)
    df = int(model["df_error"])
    combos, lmat = lsmean_rows(spec, term)
    k = len(combos)
    if k < 2:
        raise ValueError("an effect needs at least 2 cells to compare")
    if k > MAX_CELLS:
        raise ValueError(
            f"{k} cells give {k * (k - 1) // 2} pairs; at most {MAX_CELLS} cells are compared"
        )
    if lmat.shape[1] != beta.size or cov.shape != (beta.size, beta.size) or df < 1:
        raise ValueError("model coefficients do not match its terms")
    est = lmat @ beta
    m = k * (k - 1) // 2
    if method == "tukey":
        crit = float(sps.studentized_range.ppf(1.0 - alpha, k, df)) / math.sqrt(2.0)
    elif method == "bonferroni":
        crit = float(sps.t.ppf(1.0 - alpha / (2.0 * m), df))
    else:
        crit = float(sps.t.ppf(1.0 - alpha / 2.0, df))
    labels = [
        ",".join(spec.factor(nm).levels[c] for nm, c in zip(term, combo, strict=True))
        for combo in combos
    ]
    rows: list[dict[str, Any]] = []
    for i, j in itertools.combinations(range(k), 2):
        c = lmat[i] - lmat[j]
        diff = float(est[i] - est[j])
        se = math.sqrt(max(float(c @ cov @ c), 0.0))
        t = diff / se if se > 0 else math.nan
        p_raw = float(2.0 * sps.t.sf(abs(t), df)) if math.isfinite(t) else math.nan
        if method == "tukey":
            q = math.sqrt(2.0) * abs(t)
            p = float(sps.studentized_range.sf(q, k, df)) if math.isfinite(t) else math.nan
        elif method == "bonferroni":
            p = min(1.0, p_raw * m) if math.isfinite(p_raw) else math.nan
        else:
            p = p_raw
        rows.append(
            {
                "level_a": labels[i],
                "level_b": labels[j],
                "difference": diff,
                "se": se,
                "df": df,
                "t": _none(t),
                "p": _none(p),
                "p_unadjusted": _none(p_raw),
                "lower": diff - crit * se,
                "upper": diff + crit * se,
            }
        )
    return {
        "effect": term_label(term),
        "factors": list(term),
        "method": method,
        "alpha": alpha,
        "cells": k,
        "pairs": m,
        "df": df,
        "critical_value": crit,
        "rows": rows,
    }
