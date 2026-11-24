"""Effects of a two-level design: contrast effects, Lenth's pseudo standard
error, and the half-normal / Pareto quantities (GAP_AUDIT_9 J16).

The way to read an UNREPLICATED (or saturated) 2-level experiment, where a
least-squares fit has no error degrees of freedom: Daniel, "Use of half-normal
plots in interpreting factorial two-level experiments", Technometrics 1(4)
(1959) 311-341; Lenth, "Quick and easy analysis of unreplicated factorials",
Technometrics 31(4) (1989) 469-473 (PSE, margin of error ME and simultaneous
margin SME, reproduced below).

Effect of a term = mean(y where the term's coded column is +1) - mean(y where
it is -1), over the factorial (all-coded-+-1) rows with a response. In a
fraction the effect is the SUM of the aliased effects (the term's alias set).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
from scipy import stats


@dataclass(frozen=True)
class EffectRow:
    term: str
    effect: float
    abs_effect: float
    half_normal_q: float
    t_ratio: float | None  # effect / PSE
    significant: bool | None  # |effect| > SME (simultaneous margin)


def _term_name(term: Sequence[str]) -> str:
    return "*".join(term)


def effects(
    factors: Mapping[str, Sequence[float | None]],
    response: Sequence[float | None],
    terms: Sequence[Sequence[str]],
) -> dict[str, object]:
    """Contrast effects for ``terms`` (main effects and crossings of coded
    factor columns) with Lenth's PSE, ME and SME. Fails closed on missing
    structure: fewer than 4 usable runs, a factor that is not two-level, a
    term column with one sign only, or an unbalanced set of responses."""
    n = len(response)
    for name, col in factors.items():
        if len(col) != n:
            raise ValueError(f"factor {name!r} has {len(col)} values for {n} responses")
    y = np.array([np.nan if v is None else v for v in response], dtype=float)
    cols = {
        k: np.array([np.nan if v is None else v for v in c], dtype=float)
        for k, c in factors.items()
    }
    for t in terms:
        for f in t:
            if f not in cols:
                raise ValueError(f"term {_term_name(t)!r} uses unknown factor {f!r}")
    if not terms:
        raise ValueError("no effects to estimate")
    ok = np.isfinite(y)
    for c in cols.values():
        ok &= np.isfinite(c) & (np.abs(c) == 1.0)  # centre / star rows are not contrasts
    if int(ok.sum()) < 4:
        raise ValueError("need at least 4 runs with a response at the factorial (+-1) settings")
    out = []
    for t in terms:
        col = np.prod([cols[f][ok] for f in t], axis=0)
        plus, minus = col > 0, col < 0
        if not plus.any() or not minus.any():
            raise ValueError(
                f"term {_term_name(t)!r} never changes sign over the runs with a response"
            )
        if plus.sum() != minus.sum():
            raise ValueError(
                f"term {_term_name(t)!r} is unbalanced over the runs with a response "
                f"({int(plus.sum())} high, {int(minus.sum())} low): "
                "fill in every factorial run's response"
            )
        out.append(float(y[ok][plus].mean() - y[ok][minus].mean()))
    eff = np.array(out)
    m = len(eff)
    a = np.abs(eff)
    pse = me = sme = None
    if m >= 3:
        s0 = 1.5 * float(np.median(a))
        trimmed = a[a < 2.5 * s0]
        pse = 1.5 * float(np.median(trimmed if trimmed.size else a))
        d = m / 3.0
        me = float(stats.t.ppf(0.975, d) * pse)
        gamma = (1.0 + 0.95 ** (1.0 / m)) / 2.0
        sme = float(stats.t.ppf(gamma, d) * pse)
    rank = np.argsort(np.argsort(a)) + 1  # 1 = smallest |effect|
    q = stats.norm.ppf(0.5 + 0.5 * (rank - 0.5) / m)
    rows = [
        EffectRow(
            _term_name(t),
            float(eff[i]),
            float(a[i]),
            float(q[i]),
            None if not pse else float(eff[i] / pse),
            None if sme is None else bool(a[i] > sme),
        )
        for i, t in enumerate(terms)
    ]
    rows.sort(key=lambda r: -r.abs_effect)
    return {
        "n_runs": int(ok.sum()),
        "pse": pse,
        "me": me,
        "sme": sme,
        "effects": [r.__dict__ for r in rows],
    }
