"""Categorical-association tests on contingency tables of counts.

Thin, typed wrappers around ``scipy.stats`` (BSD) returning uniform result
dicts, in the style of ``calc.stats_tests`` (JMP_GAP_PLAN J3: the "categorical
x categorical" leg of the Fit Y by X workbench). Reference values pinned in
``tests/test_calc_stats_contingency.py`` against Fisher's 1935 "lady tasting
tea" worked example (a 2x2 table with hand-derivable hypergeometric and
Pearson chi-square values) plus a hand-verified R x C table.

All functions are pure: ndarrays/nested lists in, plain dicts out. No FastAPI
imports.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

_ALTERNATIVES = ("two-sided", "less", "greater")
_LOW_EXPECTED_THRESHOLD = 5.0


def _check_table(table: Any) -> NDArray[np.float64]:
    """Validate a nested-list contingency table: rectangular, >=2x2, counts >=0."""
    rows = list(table)
    if len(rows) < 2:
        raise ValueError("contingency table needs at least 2 rows")
    ncols = len(list(rows[0]))
    if ncols < 2:
        raise ValueError("contingency table needs at least 2 columns")
    for i, row in enumerate(rows):
        row = list(row)
        if len(row) != ncols:
            raise ValueError(
                f"contingency table must be rectangular: row 0 has {ncols} "
                f"columns, row {i} has {len(row)}"
            )
    arr = np.asarray([[float(v) for v in row] for row in rows], dtype=float)
    if not np.all(np.isfinite(arr)):
        raise ValueError("contingency table counts must be finite")
    if np.any(arr < 0.0):
        raise ValueError("contingency table counts must be non-negative")
    return arr


def chi_square_independence(table: Any) -> dict[str, Any]:
    """Pearson chi-square test of independence on an R x C contingency table.

    Delegates to ``scipy.stats.chi2_contingency`` (Yates' continuity
    correction applied automatically for 2x2 tables, matching scipy's and
    JMP's default). Effect size is Cramer's V:
    ``V = sqrt(chi2 / (n * (min(R, C) - 1)))``. Flags ``low_expected`` (any
    expected cell < 5) per the standard chi-square validity rule of thumb
    (Cochran 1954) — consider Fisher's exact test on 2x2 tables instead when
    this is set. Reference: Agresti, *Categorical Data Analysis*, 3rd ed.,
    ch. 3; Fisher's 1935 tea-tasting table is the pinned worked example.
    """
    arr = _check_table(table)
    chi2, p, dof, expected = sps.chi2_contingency(arr)
    n = float(arr.sum())
    r, c = arr.shape
    cramers_v = float(np.sqrt(chi2 / (n * (min(r, c) - 1)))) if n > 0 else float("nan")
    expected = np.asarray(expected, dtype=float)
    low_count = int(np.count_nonzero(expected < _LOW_EXPECTED_THRESHOLD))
    return {
        "chi2": float(chi2),
        "dof": int(dof),
        "p_value": float(p),
        "expected": expected.tolist(),
        "n": n,
        "cramers_v": cramers_v,
        "low_expected": low_count > 0,
        "low_expected_count": low_count,
        "shape": [int(r), int(c)],
        "method": "Pearson chi-square test of independence",
    }


def fisher_exact_test(table: Any, alternative: str = "two-sided") -> dict[str, Any]:
    """Fisher's exact test of independence on a 2x2 contingency table.

    Delegates to ``scipy.stats.fisher_exact``. Exact under the hypergeometric
    null (both margins fixed) — the standard alternative to chi-square when
    expected counts are small. Reference: Fisher, *The Design of Experiments*
    (1935), the "lady tasting tea" example, reproduced in Agresti, ch. 3.
    """
    if alternative not in _ALTERNATIVES:
        raise ValueError(f"alternative must be one of {_ALTERNATIVES}, got {alternative!r}")
    arr = _check_table(table)
    if arr.shape != (2, 2):
        raise ValueError(f"fisher_exact_test needs a 2x2 table, got shape {arr.shape}")
    res = sps.fisher_exact(arr, alternative=alternative)
    odds_ratio, p = float(res[0]), float(res[1])
    return {
        "odds_ratio": odds_ratio,
        "p_value": p,
        "alternative": alternative,
        "n": float(arr.sum()),
        "method": "Fisher exact test",
    }


def chi_square_gof(
    observed: NDArray[np.float64],
    expected: NDArray[np.float64] | None = None,
) -> dict[str, Any]:
    """Chi-square goodness-of-fit test against a uniform or given distribution.

    ``expected`` counts (same length as ``observed``) default to uniform
    (equal expected frequency per category, i.e. mean of ``observed``), the
    scipy default. Reference: Agresti, ch. 3.1 (one-way multinomial test).
    """
    obs = np.asarray(observed, dtype=float).ravel()
    if obs.size < 2:
        raise ValueError("chi_square_gof needs at least 2 categories")
    if np.any(obs < 0.0) or not np.all(np.isfinite(obs)):
        raise ValueError("observed counts must be finite and non-negative")
    exp_arr: NDArray[np.float64] | None = None
    if expected is not None:
        exp_arr = np.asarray(expected, dtype=float).ravel()
        if exp_arr.size != obs.size:
            raise ValueError("observed and expected must be the same length")
        if np.any(exp_arr <= 0.0) or not np.all(np.isfinite(exp_arr)):
            raise ValueError("expected counts must be finite and positive")
    res = sps.chisquare(obs, f_exp=exp_arr)
    return {
        "chi2": float(res.statistic),
        "dof": int(obs.size - 1),
        "p_value": float(res.pvalue),
        "N": int(obs.size),
        "method": "Chi-square goodness-of-fit",
    }
