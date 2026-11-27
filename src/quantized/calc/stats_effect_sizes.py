"""ANOVA effect sizes computed from an ANOVA table.

Eta squared, partial eta squared, omega squared, partial omega squared and
Cohen's f for every tested source of a fixed-effects ANOVA table (rows with
``source``, ``SS``, ``df``, ``MS``, plus an ``Error`` row and a ``Total`` row).
Item 8 of the Origin feature-gap plan; verified by hand from small tables in
``tests/test_calc_stats_effect_sizes.py``.

With ``SS_e`` and ``MS_e`` the error sum of squares and mean square, ``SS_t``
the total, ``df`` the effect's degrees of freedom and ``N`` the number of
observations (``df_total + 1``):

* eta squared          ``SS / SS_t``
* partial eta squared  ``SS / (SS + SS_e)``
* omega squared        ``(SS - df * MS_e) / (SS_t + MS_e)``
* partial omega sq.    ``(SS - df * MS_e) / (SS + (N - df) * MS_e)``
  (equal to ``df (F - 1) / (df (F - 1) + N)``, the usual between-subjects form)
* Cohen's f            ``sqrt(partial_eta_sq / (1 - partial_eta_sq))``
  (``f^2 = SS / SS_e``; for a one-way design it equals the classic f from
  eta squared)

Omega squared is an approximately unbiased estimate and is reported as
computed, so it can be slightly negative when the effect is smaller than its
chance expectation; by convention read a negative value as 0. For an
unbalanced design the sources' sums of squares need not add up to ``SS_t``
(Type III), so eta squared values need not add up to 1. A value that is
undefined (zero error or total variation) is ``None``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

__all__ = ["anova_effect_sizes", "repeated_measures_effect_sizes", "welch_omega_sq"]


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and math.isfinite(v) else None


def _ratio(num: float, den: float) -> float | None:
    return num / den if den > 0.0 else None


def _cohen_f(partial_eta: float | None) -> float | None:
    if partial_eta is None or not 0.0 <= partial_eta < 1.0:
        return None
    return math.sqrt(partial_eta / (1.0 - partial_eta))


def anova_effect_sizes(table: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """One effect-size row per tested source of an ANOVA ``table``.

    Rows named ``Error`` / ``Within`` (the error term) and ``Total`` are read
    for the denominators and are not themselves reported. Returns ``[]`` when
    the table has no error or total row to measure against.
    """
    by_name = {str(r.get("source")): r for r in table}
    error = next((by_name[k] for k in ("Error", "Within", "Residual") if k in by_name), None)
    total = by_name.get("Total")
    if error is None or total is None:
        return []
    ss_e, df_e = _num(error.get("SS")), _num(error.get("df"))
    ss_t, df_t = _num(total.get("SS")), _num(total.get("df"))
    if ss_e is None or df_e is None or ss_t is None or df_t is None or df_e <= 0:
        return []
    ms_e = ss_e / df_e
    n_obs = df_t + 1.0
    skip = {str(error.get("source")), "Total"}
    out: list[dict[str, Any]] = []
    for row in table:
        name = str(row.get("source"))
        ss, df = _num(row.get("SS")), _num(row.get("df"))
        if name in skip or ss is None or df is None or df <= 0:
            continue
        partial_eta = _ratio(ss, ss + ss_e)
        out.append({
            "source": name,
            "eta_sq": _ratio(ss, ss_t),
            "partial_eta_sq": partial_eta,
            "omega_sq": _ratio(ss - df * ms_e, ss_t + ms_e),
            "partial_omega_sq": _ratio(ss - df * ms_e, ss + (n_obs - df) * ms_e),
            "cohens_f": _cohen_f(partial_eta),
        })
    return out


def repeated_measures_effect_sizes(
    ss_cond: float, ss_subj: float, ss_err: float, df_cond: int, df_err: int, n_obs: int
) -> dict[str, float | None]:
    """Effect sizes of the condition effect of a one-way repeated-measures ANOVA.

    With ``F = MS_cond / MS_err`` and ``N`` = subjects x conditions observations:

    * ``partial_eta_sq``     ``SS_cond / (SS_cond + SS_err)``
    * ``generalized_eta_sq`` ``SS_cond / (SS_cond + SS_subj + SS_err)`` (Olejnik &
      Algina 2003, for a manipulated within-subject factor; subject variance stays
      in the denominator, so it is comparable with a between-subjects eta squared)
    * ``partial_omega_sq``   ``df (F - 1) / (df (F - 1) + N)`` (Keppel 1991, with
      ``N = a n``); subject variance is excluded, as for partial eta squared.
      It is an approximately unbiased estimate and may be slightly negative
      (read a negative value as 0).
    * ``cohens_f``          ``sqrt(partial_eta_sq / (1 - partial_eta_sq))``

    A value that is undefined (zero error or total variation) is ``None``.
    """
    ms_err = ss_err / df_err if df_err > 0 else 0.0
    f_stat = (ss_cond / df_cond) / ms_err if ms_err > 0.0 else None
    partial_eta = _ratio(ss_cond, ss_cond + ss_err)
    omega = None
    if f_stat is not None:
        omega = df_cond * (f_stat - 1.0) / (df_cond * (f_stat - 1.0) + n_obs)
    return {
        "partial_eta_sq": partial_eta,
        "generalized_eta_sq": _ratio(ss_cond, ss_cond + ss_subj + ss_err),
        "partial_omega_sq": omega,
        "cohens_f": _cohen_f(partial_eta),
    }


def welch_omega_sq(f_welch: float, df1: float, n_total: float) -> float | None:
    """Estimated omega squared of Welch's one-way ANOVA (approximate).

    The F-statistic form of omega squared, ``df1 (F - 1) / (df1 (F - 1) + N)``
    (Kirk 2013, *Experimental Design*; the same expression Lakens 2013 and the
    R ``effectsize`` package apply to an F test), evaluated at Welch's F. With
    equal variances Welch's F is close to the classical F, so it then agrees with
    the classical estimate; with unequal variances it is an estimate, not an exact
    unbiased one. It is not floored here: a value below 0 means the effect is
    smaller than its chance expectation (``welch_anova`` reports it floored at 0).
    """
    if not (math.isfinite(f_welch) and df1 > 0 and n_total > 0):
        return None
    top = df1 * (f_welch - 1.0)
    return top / (top + n_total)
