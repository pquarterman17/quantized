"""Turnbull nonparametric estimate for interval-censored life data (GAP_AUDIT_9 G8).

The nonparametric maximum-likelihood estimate (NPMLE) of the failure-time
distribution from rows ``(lower, upper)`` (see ``life_interval``): exact points
``[t, t]``, intervals ``(lower, upper]`` (left-censored rows are ``(0, upper]``)
and right-censored ``(lower, inf)``. With only exact and right-censored rows it
reduces to Kaplan-Meier (a censoring tied with a failure counts as just after
it, the same convention as ``life_nonpar``).

Algorithm (Turnbull 1976, JRSS-B 38:290; innermost intervals as in Li, Watkins
& Yu 1997 and Gentleman & Geyer 1994): mass can only sit on the *innermost
intervals* ``[q_j, p_j]``, each a left endpoint immediately followed by a right
endpoint in the sorted endpoint list (left before right on a tie; an open left
end sorts just after its value). The self-consistency / EM iteration
``p_j <- (1/n) sum_i alpha_ij p_j / sum_k alpha_ik p_k`` is run to
``max |dp| < 1e-14``, the Kuhn-Tucker conditions or ``MAX_ITER`` (SQUAREM-accelerated);
``converged`` is reported from the
Kuhn-Tucker check (every empty interval has gradient <= n). Where the data
cannot say where inside an innermost interval the mass sits, the estimate is a
step only to within that interval (reported as lower / upper). No confidence
band is produced (the NPMLE has no closed-form variance; a bootstrap is not
offered). Oracle in tests: ``lifelines`` ``KaplanMeierFitter.fit_interval_censoring``
and Kaplan-Meier for exact / right-censored data.
Provisional, owner to confirm.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc.life_interval import IntervalData

__all__ = ["turnbull"]

MAX_ITER = 5000
KKT_TOL = 1e-6


def turnbull(data: IntervalData) -> dict[str, Any]:
    n = data.n
    lo, up = data.lower, data.upper
    exact = data.exact
    vals = np.unique(np.concatenate([lo, up]))  # includes inf
    rank = {float(v): i for i, v in enumerate(vals)}
    lkey = np.array([2 * rank[float(v)] + (0 if e else 1) for v, e in zip(lo, exact, strict=True)])
    rkey = np.array([2 * rank[float(v)] for v in up])
    keys = np.concatenate([lkey, rkey])
    kind = np.concatenate([np.zeros(n, dtype=int), np.ones(n, dtype=int)])
    order = np.lexsort((kind, keys))
    sk, sd = keys[order], kind[order]
    q_idx = [i for i in range(2 * n - 1) if sd[i] == 0 and sd[i + 1] == 1]
    q_key = sk[q_idx]
    p_key = sk[[i + 1 for i in q_idx]]
    m = len(q_idx)
    alpha = (lkey[:, None] <= q_key[None, :]) & (p_key[None, :] <= rkey[:, None])
    a = alpha.astype(float)

    def em(q: Any) -> Any:
        return q * (a.T @ (1.0 / (a @ q))) / n

    def loglik(q: Any) -> float:
        return float(np.sum(np.log(a @ q)))

    def kkt_ok(q: Any) -> bool:
        grad = a.T @ (1.0 / (a @ q))  # d ll / d p_j; optimal iff == n on support, <= n elsewhere
        sup = q > 1e-9
        return bool(
            np.all(grad[~sup] <= n * (1.0 + KKT_TOL))
            and np.all(np.abs(grad[sup] - n) <= n * KKT_TOL)
        )

    p = np.full(m, 1.0 / m)
    converged_em = False
    for it in range(MAX_ITER):
        # SQUAREM (Varadhan & Roland 2008) acceleration of the EM map; plain EM converges
        # only sub-linearly when the optimum has empty innermost intervals.
        p1 = em(p)
        p2 = em(p1)
        r, v = p1 - p, p2 - p1 - (p1 - p)
        nv = float(np.linalg.norm(v))
        if nv > 0.0:
            alpha_s = min(-float(np.linalg.norm(r)) / nv, -1.0)
            cand = np.maximum(p - 2.0 * alpha_s * r + alpha_s**2 * v, 1e-300)
            cand = em(cand / cand.sum())
            p_new = cand if loglik(cand) >= loglik(p2) else p2
        else:
            p_new = p2
        done = float(np.max(np.abs(p_new - p))) < 1e-14
        p = p_new
        if done or (it % 5 == 0 and kkt_ok(p)):
            converged_em = True
            break
    p = np.where(p < 1e-12, 0.0, p)
    p = p / p.sum()
    kkt = kkt_ok(p)
    # Real-valued endpoints of each innermost interval.
    inv_vals = {2 * i: float(v) for i, v in enumerate(vals)}
    lower = [inv_vals.get(int(k), inv_vals.get(int(k) - 1, 0.0)) for k in q_key]
    upper = [inv_vals[int(k)] for k in p_key]
    cum = np.cumsum(p)
    return {
        "lower": [float(x) for x in lower],
        "upper": [float(x) for x in upper],
        "mass": [float(x) for x in p],
        "cdf": [float(min(max(x, 0.0), 1.0)) for x in cum],
        "survival": [float(max(1.0 - x, 0.0)) for x in cum],
        "n": n,
        "iterations_converged": converged_em,
        "converged": kkt,
        "method": "Turnbull self-consistency (EM) on innermost intervals; no confidence band",
    }
