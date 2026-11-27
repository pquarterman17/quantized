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

__all__ = ["anova_effect_sizes"]


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
