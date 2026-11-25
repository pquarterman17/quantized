"""Change-point detection by PELT and binary segmentation (GAP_AUDIT_9 G13).

Penalised segmentation: minimise sum of segment costs + penalty * (number of
changes). Segment costs are -2 log-likelihood (up to constants) of a Gaussian:

* ``mean``    : change in mean, variance known: cost = sum((y - segment mean)^2) / sigma^2.
                sigma^2 is the user's ``sigma`` or the robust estimate
                (MAD of the first differences / sqrt(2))^2 (Killick & Eckley 2014).
* ``var``     : change in variance about the global mean: cost = m ln(sum((y - mu)^2) / m).
* ``meanvar`` : change in mean and variance: cost = m ln(sum((y - segment mean)^2) / m).

Penalty per change (provisional, owner to confirm): with p the parameters a
change adds (1 for mean/var, 2 for meanvar) and the change location counted as
one more, ``bic`` = (p + 1) ln n, ``aic`` = 2 (p + 1), ``mbic`` = (p + 2) ln n
(a modified-BIC flavour after Zhang & Siegmund, Biometrics 63 (2007) 22, the
default because plain BIC over-segments noisy data); or a user value.

PELT: Killick, Fearnhead & Eckley, JASA 107 (2012) 1590-1598, with pruning
constant K = 0 (valid for these negative-log-likelihood costs). Binary
segmentation: Scott & Knott, Biometrics 30 (1974) 507-512 (a split is kept
while its cost reduction exceeds the penalty); optional ``max_changes``.

A change point is the index of the FIRST sample of the new segment.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["detect", "segment_cost_fn"]

_COSTS = ("mean", "var", "meanvar")
_FLOOR = 1e-12
#: PELT is O(n) when pruning works but O(n^2) when it cannot (a tiny penalty).
MAX_CHANGEPOINT_POINTS = 50_000


def segment_cost_fn(y: NDArray[np.float64], cost: str, sigma2: float):  # type: ignore[no-untyped-def]
    """Return ``f(a, b)`` = cost of y[a:b] (vectorised over numpy ``a``)."""
    c1 = np.concatenate(([0.0], np.cumsum(y)))
    c2 = np.concatenate(([0.0], np.cumsum(y * y)))
    scale = max(float(np.var(y)), _FLOOR)
    if cost == "mean":

        def f(a: Any, b: int) -> Any:
            m = b - a
            return (c2[b] - c2[a] - (c1[b] - c1[a]) ** 2 / m) / sigma2

    elif cost == "var":
        mu = float(y.mean())
        d2 = np.concatenate(([0.0], np.cumsum((y - mu) ** 2)))

        def f(a: Any, b: int) -> Any:
            m = b - a
            return m * np.log(np.maximum((d2[b] - d2[a]) / m, _FLOOR * scale))

    else:

        def f(a: Any, b: int) -> Any:
            m = b - a
            ss = c2[b] - c2[a] - (c1[b] - c1[a]) ** 2 / m
            return m * np.log(np.maximum(ss / m, _FLOOR * scale))

    return f


def _pelt(f: Any, n: int, pen: float, min_size: int) -> list[int]:
    """PELT with K = 0. A start pruned at time t is dropped only for ends
    u >= t + min_size (t is not an admissible split of a shorter segment), which
    keeps the result exact when min_size > 1."""
    best = np.full(n + 1, np.inf)
    best[0] = -pen
    prev = np.zeros(n + 1, dtype=int)
    cand: list[int] = []
    drop_at: dict[int, list[int]] = {}
    for t in range(min_size, n + 1):
        s_new = t - min_size
        if s_new == 0 or s_new >= min_size:
            cand.append(s_new)
        gone = set(drop_at.pop(t, ()))
        if gone:
            cand = [s for s in cand if s not in gone]
        ca = np.array(cand, dtype=int)
        vals = best[ca] + f(ca, t) + pen
        k = int(np.argmin(vals))
        best[t] = vals[k]
        prev[t] = ca[k]
        dead = [int(s) for s, v in zip(ca, vals, strict=True) if v - pen > best[t]]
        if dead:
            drop_at.setdefault(t + min_size, []).extend(dead)
    cps = []
    t = n
    while t > 0:
        s = int(prev[t])
        if s > 0:
            cps.append(s)
        t = s
    return sorted(cps)


def _binseg(f: Any, n: int, pen: float, min_size: int, max_changes: int | None) -> list[int]:
    cps: list[int] = []

    # best single split of each live segment: (gain, split, a, b)
    def best_split(a: int, b: int) -> tuple[float, int]:
        if b - a < 2 * min_size:
            return (-np.inf, -1)
        ks = np.arange(a + min_size, b - min_size + 1)
        gain = float(f(a, b)) - f(a, ks) - f(ks, b)
        i = int(np.argmax(gain))
        return (float(gain[i]), int(ks[i]))

    live = {(0, n): best_split(0, n)}
    while live and (max_changes is None or len(cps) < max_changes):
        seg = max(live, key=lambda s: live[s][0])
        gain, k = live.pop(seg)
        if gain <= pen:
            break
        cps.append(k)
        live[(seg[0], k)] = best_split(seg[0], k)
        live[(k, seg[1])] = best_split(k, seg[1])
    return sorted(cps)


def _penalty(kind: str, n: int, p: int, value: float | None) -> float:
    if kind == "value":
        if value is None or not np.isfinite(value) or value < 0:
            raise ValueError("penalty_value must be a non-negative number")
        return float(value)
    if kind == "bic":
        return float((p + 1) * np.log(n))
    if kind == "aic":
        return 2.0 * (p + 1)
    if kind == "mbic":
        return float((p + 2) * np.log(n))
    raise ValueError("penalty must be 'bic', 'aic', 'mbic' or 'value'")


def detect(
    y: NDArray[np.float64],
    method: str = "pelt",
    cost: str = "mean",
    penalty: str = "mbic",
    penalty_value: float | None = None,
    min_size: int = 2,
    max_changes: int | None = None,
    sigma: float | None = None,
) -> dict[str, Any]:
    y = np.asarray(y, dtype=float)
    n = y.size
    if method not in ("pelt", "binseg"):
        raise ValueError("method must be 'pelt' or 'binseg'")
    if cost not in _COSTS:
        raise ValueError(f"cost must be one of {_COSTS}")
    if n > MAX_CHANGEPOINT_POINTS:
        raise ValueError(
            f"change-point search is limited to {MAX_CHANGEPOINT_POINTS} points; "
            "decimate or resample the series first"
        )
    if min_size < 2:
        raise ValueError("min_size must be at least 2 samples")
    if n < 2 * min_size:
        raise ValueError(f"need at least {2 * min_size} points for min_size {min_size}")
    if max_changes is not None and max_changes < 1:
        raise ValueError("max_changes must be at least 1")
    if method == "pelt" and max_changes is not None:
        raise ValueError("max_changes applies to binary segmentation only")
    if sigma is not None and not (np.isfinite(sigma) and sigma > 0):
        raise ValueError("sigma must be positive")
    if cost != "var" and float(np.ptp(y)) == 0.0:
        raise ValueError("the series is constant: there is nothing to segment")
    if sigma is not None:
        sigma2 = float(sigma) ** 2
    else:
        mad = float(np.median(np.abs(np.diff(y) - np.median(np.diff(y)))))
        sigma2 = (1.4826 * mad / np.sqrt(2.0)) ** 2
        if sigma2 <= 0.0:
            sigma2 = float(np.var(y)) or 1.0
    p = 2 if cost == "meanvar" else 1
    pen = _penalty(penalty, n, p, penalty_value)
    f = segment_cost_fn(y, cost, sigma2)
    cps = (
        _pelt(f, n, pen, min_size)
        if method == "pelt"
        else _binseg(f, n, pen, min_size, max_changes)
    )
    edges = [0, *cps, n]
    segments = []
    for a, b in zip(edges[:-1], edges[1:], strict=True):
        seg = y[a:b]
        segments.append(
            {
                "start": a,
                "end": b - 1,
                "n": b - a,
                "mean": float(seg.mean()),
                "sd": float(seg.std(ddof=1)) if b - a > 1 else None,
            }
        )
    total = float(sum(f(a, b) for a, b in zip(edges[:-1], edges[1:], strict=True))) + pen * len(cps)
    return {
        "method": method,
        "cost": cost,
        "penalty": penalty,
        "penalty_used": pen,
        "sigma2": sigma2 if cost == "mean" else None,
        "min_size": min_size,
        "n": n,
        "changepoints": cps,
        "segments": segments,
        "objective": total,
    }
