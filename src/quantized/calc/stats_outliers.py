"""Outlier screening tests (JMP_GAP_PLAN J9 backend half).

Grubbs (single outlier), Rosner generalized ESD (up to k outliers), Dixon's
Q (small samples), and robust MAD-based modified z-scores. Style matches
``calc.stats_tests``: pure numpy/scipy wrappers returning uniform result
dicts. No FastAPI imports (layering is test-enforced).

**Never mutates or drops caller data.** Every function reports FLAGGED
INDICES into the caller's original input array; the array itself is only
ever read. Row exclusion/deletion is a UI-level decision (select flagged
rows, then use the existing exclude/keep-only row actions) -- these
functions only screen and report.

**NaN/Inf policy:** finite values are screened; non-finite entries are
excluded from the statistics (never silently coerced to 0 or dropped from
the caller's array) and reported back via ``excluded_indices`` so the
caller always knows what was skipped. All returned index fields -- both
``flagged_indices`` and ``excluded_indices`` -- index into the ORIGINAL
input array, not the cleaned subset.

References:
- Grubbs: Grubbs, Technometrics 11 (1969) 1; formula as tabulated in the
  NIST/SEMATECH e-Handbook of Statistical Methods, section 1.3.5.17.1.
- Rosner: Rosner, Technometrics 25 (1983) 165 ("Percentage Points for a
  Generalized ESD Many-Outlier Procedure"); worked example (n=54, k=10)
  in NIST/SEMATECH e-Handbook section 1.3.5.17.3.
- Dixon: Dean & Dixon, Anal. Chem. 23 (1951) 636 (the r10/r11/r21/r22
  subrange-ratio scheme); critical values re-tabulated by Rorabacher,
  Anal. Chem. 63 (1991) 139-146 ("Statistical Treatment for Rejection of
  Deviant Values: Critical Values of Dixon's Q Parameter and Related
  Subrange Ratios at the 95% Confidence Level") -- the standard modern
  table, also reproduced e.g. in Harvey's *Analytical Chemistry*
  appendix. RE-VERIFIED 2026-07-31 (JMP_GAP_PLAN's standing n>20 caveat,
  now with web access) against three independent sources -- table
  CONFIRMED CORRECT AS TRANSCRIBED, no changes made:
    1. n=3-7 (the r10 range) match Harvey's *Analytical Chemistry*
       appendix and Wikipedia's "Dixon's Q test" table EXACTLY to 3
       decimals -- both cite Rorabacher (1991) by name.
    2. n=8 (the first r11 row) is corroborated within Monte Carlo
       simulation noise by NIST Dataplot's independent 25,000-sample
       simulation (itl.nist.gov, ASTM E178-08-based): our alpha=0.05
       column (0.615) is an EXACT match to NIST's 97.5th percentile
       point (0.615); alpha=0.10 (0.554) is within 0.002 of NIST's 95th
       percentile (0.552); alpha=0.01 (0.717) is within 0.007 of NIST's
       99.5th percentile (0.724) -- consistent with simulation noise at
       that tail.
    3. Every row n=8 through n=25 (spanning all four ratio statistics,
       r11/r21/r22) was cross-checked against Kanji, G. K., *100
       Statistical Tests*, SAGE (1993) -- a full published Dixon table
       covering the same r10/r11/r21/r22 formulas. Kanji's table uses a
       ONE-SIDED alpha convention where this module's TWO-SIDED alpha is
       double Kanji's (confirmed by the exact n=3 match: this module's
       two-sided alpha=0.10 -> 0.941 == Kanji's one-sided alpha=0.05 ->
       0.941). Once that convention is accounted for, this module's
       alpha=0.10 column matches Kanji's alpha=0.05 column EXACTLY (3
       decimals) for every single row n=8..25 -- strong independent
       confirmation the transcribed VALUES are right, not just the
       n=3-7 subset. The tighter alpha=0.01 column shows small,
       systematic differences from Kanji's alpha=0.005 column (up to
       ~0.02 at n=25, growing with n) -- expected, since Kanji
       reproduces the pre-1991 Dean & Dixon table Rorabacher's paper
       explicitly corrects, and corrections concentrate in the extreme
       tail.
  n=26-30 have no independently-tabulated cross-check available online
  (Kanji's accessible table stops at n=25); those five rows continue the
  same smooth monotonic trend as n=8-25 with no discontinuity, and
  Rorabacher's paper is documented to cover exactly n=3-30 (this
  module's own domain bound, ``3 <= n <= 30`` in ``dixon_q_test``) so no
  truncation or extrapolation is needed.
- MAD: Iglewicz & Hoaglin, "How to Detect and Handle Outliers", ASQC
  Quality Press (1993) -- the modified z-score and its MAD==0 fallback.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = ["grubbs_test", "rosner_test", "dixon_q_test", "mad_outliers"]

_TAILS = ("two-sided", "less", "greater")


def _check_tail(tail: str) -> str:
    if tail not in _TAILS:
        raise ValueError(f"tail must be one of {_TAILS}, got {tail!r}")
    return tail


def _check_alpha(alpha: float) -> float:
    if not (0.0 < alpha < 1.0):
        raise ValueError("alpha must be in (0, 1)")
    return alpha


def _clean_indexed(
    x: NDArray[np.float64],
) -> tuple[NDArray[np.float64], NDArray[np.intp], NDArray[np.intp]]:
    """Split ``x`` into (finite values, their original indices, excluded indices).

    Read-only: never mutates ``x``. Every downstream index is expressed in
    terms of ``finite_idx``/``excluded_idx`` so callers can always map back
    to the untouched input.
    """
    arr = np.asarray(x, dtype=float).ravel()
    finite_mask = np.isfinite(arr)
    finite_idx = np.flatnonzero(finite_mask)
    excluded_idx = np.flatnonzero(~finite_mask)
    return arr[finite_mask], finite_idx, excluded_idx


def grubbs_test(
    x: NDArray[np.float64],
    alpha: float = 0.05,
    tail: str = "two-sided",
) -> dict[str, Any]:
    """Grubbs' test for a single outlier (the k=1 case of generalized ESD).

    ``G`` is the largest standardized deviation from the sample mean; the
    critical value comes from the t-distribution formula (NIST/SEMATECH
    1.3.5.17.1): for two-sided, ``G_crit = (N-1)/sqrt(N) *
    sqrt(t^2 / (N-2+t^2))`` with ``t`` the upper ``alpha/(2N)`` point of
    Student's t on N-2 df; one-sided tests (``tail='greater'``/``'less'``,
    testing only the maximum/minimum) use ``alpha/N`` instead. Grubbs has
    no closed-form p-value -- the standard practice (and this function's)
    is a critical-value decision, reported as ``flagged``.
    """
    _check_tail(tail)
    _check_alpha(alpha)
    arr, orig_idx, excluded_idx = _clean_indexed(x)
    n = int(arr.size)
    if n < 3:
        raise ValueError("grubbs_test needs at least 3 finite observations")

    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1))
    if std == 0.0:
        raise ValueError("grubbs_test: zero variance (all finite values identical)")

    dev = np.asarray(arr - mean, dtype=float)
    if tail == "two-sided":
        j = int(np.argmax(np.abs(dev)))
        g = float(abs(dev[j]) / std)
        tail_alpha = alpha / (2 * n)
    elif tail == "greater":
        j = int(np.argmax(dev))
        g = float(dev[j] / std)
        tail_alpha = alpha / n
    else:  # "less"
        j = int(np.argmin(dev))
        g = float(-dev[j] / std)
        tail_alpha = alpha / n

    t_crit = float(sps.t.ppf(1.0 - tail_alpha, n - 2))
    g_crit = (n - 1) / math.sqrt(n) * math.sqrt(t_crit**2 / (n - 2 + t_crit**2))
    flagged = g > g_crit
    index = int(orig_idx[j])

    return {
        "G": g,
        "G_critical": g_crit,
        "flagged": bool(flagged),
        "flagged_indices": [index] if flagged else [],
        "index": index,
        "value": float(arr[j]),
        "tail": tail,
        "alpha": alpha,
        "N": n,
        "excluded_indices": excluded_idx.tolist(),
        "method": "Grubbs test (single outlier)",
    }


def rosner_test(x: NDArray[np.float64], k: int, alpha: float = 0.05) -> dict[str, Any]:
    """Generalized ESD test for up to ``k`` outliers (Rosner, 1983).

    Iteratively removes the point farthest (in standardized units) from
    the current sample mean, ``k`` times, comparing each iteration's ``R_i``
    to a critical ``lambda_i``. Per Rosner's procedure the number of
    outliers reported is the LARGEST ``i`` with ``R_i > lambda_i`` -- not
    necessarily ``i=k``, and not necessarily monotonic in ``i``. Validated
    against the classic NIST/SEMATECH 1.3.5.17.3 worked example (n=54,
    k=10 -> 3 outliers: 6.01, 5.42, 5.34) in the test suite. Read-only:
    the iterative removal operates on an internal working copy, never the
    caller's array.
    """
    if not isinstance(k, (int, np.integer)) or k < 1:
        raise ValueError("rosner_test: k must be a positive integer")
    _check_alpha(alpha)
    arr, orig_idx, excluded_idx = _clean_indexed(x)
    n = int(arr.size)
    if n < k + 2:
        raise ValueError(f"rosner_test needs at least k+2={k + 2} finite observations for k={k}")

    work = arr.copy()
    work_idx = orig_idx.copy()
    table: list[dict[str, Any]] = []
    for i in range(1, int(k) + 1):
        m = work.size
        mean = float(np.mean(work))
        sd = float(np.std(work, ddof=1))
        if sd == 0.0:
            break  # remaining points are identical -- nothing left to standardize
        dev = np.asarray(np.abs(work - mean), dtype=float)
        j = int(np.argmax(dev))
        r_stat = float(dev[j] / sd)
        p = 1.0 - alpha / (2 * m)
        t_crit = float(sps.t.ppf(p, m - 2))
        lam = (m - 1) * t_crit / math.sqrt(m * (m - 2 + t_crit**2))
        table.append(
            {
                "i": i,
                "R": r_stat,
                "lambda_critical": lam,
                "index": int(work_idx[j]),
                "value": float(work[j]),
                "exceeds": bool(r_stat > lam),
            }
        )
        work = np.delete(work, j)
        work_idx = np.delete(work_idx, j)

    num_outliers = 0
    for row in table:
        if row["exceeds"]:
            num_outliers = int(row["i"])

    flagged_indices = [int(row["index"]) for row in table[:num_outliers]]
    flagged_values = [float(row["value"]) for row in table[:num_outliers]]

    return {
        "num_outliers": num_outliers,
        "flagged_indices": flagged_indices,
        "flagged_values": flagged_values,
        "table": table,
        "k": int(k),
        "alpha": alpha,
        "N": n,
        "excluded_indices": excluded_idx.tolist(),
        "method": "generalized ESD (Rosner)",
    }


# Dixon's Q critical values, Rorabacher (1991) Anal. Chem. 63(2) 139-146,
# Table II -- the modern re-tabulation of Dean & Dixon (1951)'s scheme.
# Columns are (Q_0.10, Q_0.05, Q_0.01) two-sided confidence; the ratio
# statistic changes with n (see `_dixon_ratio_name`), which is why the
# table is NOT monotonic across the n=8 and n=11 breakpoints (r11/r21 use
# a smaller-magnitude denominator than r10, pushing the raw ratio -- and
# so its critical value -- up at the breakpoint). RE-VERIFIED 2026-07-31
# against NIST Dataplot's simulation + Kanji's "100 Statistical Tests"
# (1993) -- see the module docstring's Dixon reference entry for the
# full cross-check trail. Confirmed correct as transcribed; unchanged.
_DIXON_CRITICAL: dict[int, tuple[float, float, float]] = {
    3: (0.941, 0.970, 0.994),
    4: (0.765, 0.829, 0.926),
    5: (0.642, 0.710, 0.821),
    6: (0.560, 0.625, 0.740),
    7: (0.507, 0.568, 0.680),
    8: (0.554, 0.615, 0.717),
    9: (0.512, 0.570, 0.672),
    10: (0.477, 0.534, 0.635),
    11: (0.576, 0.625, 0.708),
    12: (0.546, 0.592, 0.670),
    13: (0.521, 0.565, 0.638),
    14: (0.546, 0.590, 0.670),
    15: (0.525, 0.568, 0.643),
    16: (0.507, 0.548, 0.621),
    17: (0.490, 0.531, 0.601),
    18: (0.475, 0.516, 0.584),
    19: (0.462, 0.503, 0.568),
    20: (0.450, 0.489, 0.554),
    21: (0.440, 0.478, 0.541),
    22: (0.430, 0.468, 0.529),
    23: (0.421, 0.459, 0.517),
    24: (0.413, 0.450, 0.507),
    25: (0.406, 0.442, 0.498),
    26: (0.399, 0.435, 0.489),
    27: (0.393, 0.428, 0.486),
    28: (0.387, 0.421, 0.475),
    29: (0.381, 0.415, 0.467),
    30: (0.376, 0.409, 0.460),
}
_DIXON_ALPHA_COL = {0.10: 0, 0.05: 1, 0.01: 2}


def _dixon_ratio_name(n: int) -> str:
    if 3 <= n <= 7:
        return "r10"
    if 8 <= n <= 10:
        return "r11"
    if 11 <= n <= 13:
        return "r21"
    return "r22"  # 14 <= n <= 30, range enforced by the caller


def _dixon_q_stat(s: NDArray[np.float64], ratio: str) -> tuple[float, float]:
    """(Q_low, Q_high) subrange ratios for sorted ``s`` under ``ratio``'s scheme."""
    if ratio == "r10":
        denom = s[-1] - s[0]
        return float((s[1] - s[0]) / denom), float((s[-1] - s[-2]) / denom)
    if ratio == "r11":
        return (
            float((s[1] - s[0]) / (s[-2] - s[0])),
            float((s[-1] - s[-2]) / (s[-1] - s[1])),
        )
    if ratio == "r21":
        return (
            float((s[2] - s[0]) / (s[-2] - s[0])),
            float((s[-1] - s[-3]) / (s[-1] - s[1])),
        )
    # r22
    return (
        float((s[2] - s[0]) / (s[-3] - s[0])),
        float((s[-1] - s[-3]) / (s[-1] - s[2])),
    )


def dixon_q_test(x: NDArray[np.float64], alpha: float = 0.05) -> dict[str, Any]:
    """Dixon's Q test for a single outlier in a small sample (3 <= n <= 30).

    Uses the ratio (r10/r11/r21/r22) matched to n per Dixon's published
    scheme; ``alpha`` must be one of the table's published columns (0.10,
    0.05, 0.01) -- interpolation is not offered. Both extremes are
    evaluated and the larger of (Q_low, Q_high) is reported as the
    suspect tail, the conventional "automatic direction" use of the test
    when no end is suspected a priori.
    """
    if alpha not in _DIXON_ALPHA_COL:
        raise ValueError("dixon_q_test: alpha must be one of 0.10, 0.05, 0.01 (published columns)")
    arr, orig_idx, excluded_idx = _clean_indexed(x)
    n = int(arr.size)
    if n < 3 or n > 30:
        raise ValueError(f"dixon_q_test needs 3 <= n <= 30 finite observations, got n={n}")

    order = np.argsort(arr, kind="stable")
    s = arr[order]
    s_idx = orig_idx[order]
    if s[-1] == s[0]:
        raise ValueError("dixon_q_test: zero range (all finite values identical)")

    ratio = _dixon_ratio_name(n)
    q_lo, q_hi = _dixon_q_stat(s, ratio)
    q_crit = _DIXON_CRITICAL[n][_DIXON_ALPHA_COL[alpha]]

    if q_hi >= q_lo:
        q_stat, test_tail, j = q_hi, "high", int(s.size - 1)
    else:
        q_stat, test_tail, j = q_lo, "low", 0

    flagged = q_stat > q_crit
    index = int(s_idx[j])

    return {
        "Q": q_stat,
        "Q_critical": q_crit,
        "ratio": ratio,
        "tail": test_tail,
        "flagged": bool(flagged),
        "flagged_indices": [index] if flagged else [],
        "index": index,
        "value": float(s[j]),
        "alpha": alpha,
        "N": n,
        "excluded_indices": excluded_idx.tolist(),
        "method": "Dixon's Q test",
    }


def mad_outliers(x: NDArray[np.float64], threshold: float = 3.5) -> dict[str, Any]:
    """Robust modified z-score outlier flagging (Iglewicz & Hoaglin, 1993).

    ``M_i = 0.6745 * (x_i - median) / MAD``. When MAD == 0 (>=50% of the
    finite data ties the median), falls back to the mean-absolute-deviation
    form ``M_i = (x_i - median) / (1.253314 * MeanAD)`` -- the fallback
    Iglewicz & Hoaglin themselves recommend for that case. If MeanAD is
    also 0 (every finite value identical), every score is defined as 0
    rather than left as an undefined 0/0 (there is no meaningful spread to
    be an outlier from). Default ``threshold=3.5`` per Iglewicz & Hoaglin.
    """
    if threshold <= 0:
        raise ValueError("mad_outliers: threshold must be positive")
    arr, orig_idx, excluded_idx = _clean_indexed(x)
    n = int(arr.size)
    if n < 2:
        raise ValueError("mad_outliers needs at least 2 finite observations")

    median = float(np.median(arr))
    abs_dev = np.asarray(np.abs(arr - median), dtype=float)
    mad = float(np.median(abs_dev))

    if mad > 0:
        z = np.asarray(0.6745 * (arr - median) / mad, dtype=float)
        scale_method = "MAD"
    else:
        mean_ad = float(np.mean(abs_dev))
        if mean_ad > 0:
            z = np.asarray((arr - median) / (1.253314 * mean_ad), dtype=float)
            scale_method = "MeanAD (MAD==0 fallback)"
        else:
            z = np.zeros_like(arr)
            scale_method = "degenerate (MAD==0 and MeanAD==0 -- all finite values identical)"

    flagged_local = np.flatnonzero(np.abs(z) > threshold)
    flagged_indices = [int(i) for i in orig_idx[flagged_local]]

    # Full length of the ORIGINAL input, NaN at excluded positions, so a
    # caller can overlay z-scores against the untouched input index-for-index.
    full_z = np.full(np.asarray(x, dtype=float).ravel().shape, np.nan, dtype=float)
    full_z[orig_idx] = z

    return {
        "modified_z_scores": full_z,
        "median": median,
        "mad": mad,
        "scale_method": scale_method,
        "threshold": threshold,
        "flagged_indices": flagged_indices,
        "N": n,
        "excluded_indices": excluded_idx.tolist(),
        "method": "modified z-score (Iglewicz & Hoaglin)",
    }
