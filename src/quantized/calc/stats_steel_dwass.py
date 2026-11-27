"""Steel-Dwass all-pairs rank test (Dwass-Steel-Critchlow-Fligner).

The nonparametric analogue of Tukey's HSD: every pair of ``k`` independent
groups is compared with a Wilcoxon-Mann-Whitney rank-sum statistic and the
familywise error is controlled with the studentized range distribution.

Exact variant implemented (Hollander & Wolfe, *Nonparametric Statistical
Methods*, 2nd ed., sec. 7.3; Critchlow & Fligner, *Commun. Statist. Simul.
Comput.* 20, 127-139, 1991). For the pair ``(i, j)`` the two groups are ranked
TOGETHER AGAIN, on their own (pairwise ranking, average ranks for ties), with
``N = n_i + n_j``:

* ``W`` is the sum of group ``i``'s ranks, ``E = n_i (N + 1) / 2``;
* ``Var = n_i n_j / 12 * [(N + 1) - sum(t^3 - t) / (N (N - 1))]`` over the tie
  groups of size ``t`` (the tie-corrected variance; no ties: ``n_i n_j (N+1)/12``);
* ``z = (W - E) / sqrt(Var)`` (positive: group ``i`` ranks higher) and
  ``q = sqrt(2) |z|``;
* ``p = P(Q_{k, inf} >= q)``, the upper tail of the studentized range for
  ``k`` groups and infinite degrees of freedom (``scipy.stats.studentized_range``),
  the asymptotic DSCF p-value. Critchlow & Fligner's exact small-sample
  distribution is NOT used, so for very small groups the p-values are
  approximate. With ``k = 2`` it reduces to the two-sided normal-approximation
  Wilcoxon-Mann-Whitney p-value without continuity correction.

A pair whose combined sample is entirely tied has zero variance and is
refused. ``omnibus_p`` is the Kruskal-Wallis p-value for context. Pure
numpy / scipy; oracles in ``tests/test_calc_stats_steel_dwass.py`` (a
hand-computed example, an independent brute-force implementation, the
``k = 2`` normal limit).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_group_tests import _check_alpha, _groups

__all__ = ["steel_dwass"]


def steel_dwass(groups: list[NDArray[np.float64]], *, alpha: float = 0.05) -> dict[str, Any]:
    """All-pairs Steel-Dwass comparisons in the ``posthoc`` result shape."""
    _check_alpha(alpha)
    gs = _groups(groups, min_n=1)
    k = len(gs)
    rows: list[dict[str, Any]] = []
    for i in range(k):
        for j in range(i + 1, k):
            ni, nj = gs[i].size, gs[j].size
            n = ni + nj
            pooled = np.concatenate([gs[i], gs[j]])
            ranks = sps.rankdata(pooled)
            w = float(ranks[:ni].sum())
            e = ni * (n + 1) / 2.0
            _, counts = np.unique(pooled, return_counts=True)
            tie = float(np.sum(counts.astype(float) ** 3 - counts))
            var = ni * nj / 12.0 * ((n + 1) - tie / (n * (n - 1)))
            if var <= 0.0:
                raise ValueError(
                    f"groups {i + 1} and {j + 1} are completely tied; "
                    "rank comparisons are undefined"
                )
            se = math.sqrt(var)
            z = (w - e) / se
            q = math.sqrt(2.0) * abs(z)
            p = float(min(1.0, sps.studentized_range.sf(q, k, np.inf)))
            rows.append(
                {
                    "i": i,
                    "j": j,
                    "W": w,
                    "diff": w - e,
                    "se": se,
                    "statistic": z,
                    "q": q,
                    "df": None,
                    "p_raw": float(2.0 * sps.norm.sf(abs(z))),
                    "p": p,
                    "ciLow": None,
                    "ciHigh": None,
                    "effect_size": None,
                    "significant": bool(p < alpha),
                }
            )
    omnibus = float(sps.kruskal(*gs).pvalue) if k >= 2 and np.ptp(np.concatenate(gs)) > 0 else None
    return {
        "pairs": rows,
        "n_groups": k,
        "alpha": alpha,
        "method": "Steel-Dwass (Dwass-Steel-Critchlow-Fligner)",
        "key": "steel-dwass",
        "omnibus_p": omnibus,
        "adjusted": True,
        "groups": [
            {"index": i, "n": int(g.size), "mean": float(np.mean(g))} for i, g in enumerate(gs)
        ],
        "diff_kind": "rank sum minus its expectation",
    }
