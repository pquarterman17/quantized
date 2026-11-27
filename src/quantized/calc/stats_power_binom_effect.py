"""Detectable effect of the exact binomial test: the smallest ``p1`` reaching a target power.

For a fixed sample size ``n`` the exact test's rejection region depends only on
``p0``, ``alpha`` and the sidedness, so the power at a true proportion ``p1`` is
the smooth function ``P(K in region | n, p1)`` of ``p1`` (a lower tail ``K <= a``
plus an upper tail ``K >= b``). It is NOT monotone in ``p1`` for a two-sided test
(just above ``p0`` it can sit below alpha), and in ``n`` it is a sawtooth, so
no single root-finder bracket is trustworthy. The solve therefore scans a fine
grid of ``p1`` away from ``p0`` to the first point at or above the target, then
bisects the last grid cell below it, and returns the upper end of the final
bracket: the smallest ``p1`` found whose exact power is at least the target (to
1e-12 in ``p1``). A dip that stays within one grid cell (step 5e-5 of the
side's width) is below the scan's resolution; the answer is always a ``p1``
whose power was evaluated and is at least the target.

Each side of ``p0`` is solved on its own (the alternative above and below), the
answer being ``None`` for a side where no ``p1`` reaches the target at this n.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy import stats

from quantized.calc.stats_power_more import binomial_rejection_region

__all__ = ["binomial_detectable_p1"]

_GRID = 20_001


def _tails(region: NDArray[np.bool_]) -> tuple[int, int]:
    """(a, b): the region is ``K <= a`` plus ``K >= b`` (a = -1, b = n + 1 for an empty tail)."""
    n = region.size - 1
    a = -1
    while a < n and region[a + 1]:
        a += 1
    b = n + 1
    while b > 0 and region[b - 1]:
        b -= 1
    if b <= a:  # everything rejected
        return n, n + 1
    expected = np.zeros(n + 1, dtype=bool)
    expected[: a + 1] = True
    expected[b:] = True
    if not np.array_equal(expected, region):  # not two tails: cannot happen for a unimodal pmf
        raise ValueError("the rejection region is not a lower plus an upper tail")
    return a, b


def _power(p1: NDArray[np.float64] | float, n: int, a: int, b: int) -> NDArray[np.float64]:
    p = np.asarray(p1, dtype=float)
    low = stats.binom.cdf(a, n, p) if a >= 0 else np.zeros_like(p)
    up = stats.binom.sf(b - 1, n, p) if b <= n else np.zeros_like(p)
    return np.asarray(np.clip(low + up, 0.0, 1.0), dtype=float)


def _side(
    n: int, a: int, b: int, p0: float, target: float, upper: bool
) -> tuple[float, float] | None:
    grid = np.linspace(p0, 1.0, _GRID)[1:] if upper else np.linspace(p0, 0.0, _GRID)[1:]
    pw = _power(grid, n, a, b)
    hit = np.flatnonzero(pw >= target)
    if hit.size == 0:
        return None
    i = int(hit[0])
    good = float(grid[i])
    bad = float(grid[i - 1]) if i > 0 else p0
    if (
        i == 0 and float(_power(bad, n, a, b)) >= target
    ):  # even p0 itself (size > target): nothing to bisect
        return bad, float(_power(bad, n, a, b))
    for _ in range(200):
        mid = 0.5 * (good + bad)
        if mid == good or mid == bad:
            break
        if float(_power(mid, n, a, b)) >= target:
            good = mid
        else:
            bad = mid
    return good, float(_power(good, n, a, b))


def binomial_detectable_p1(
    p0: float, n: int, target: float, *, alpha: float = 0.05, tails: int = 2
) -> dict[str, tuple[float, float] | None]:
    """``{"up": (p1, power), "down": (p1, power)}``: the nearest ``p1`` on each side of ``p0``.

    Each entry is the smallest effect (closest to ``p0``) whose exact power at ``n``
    is at least ``target``, with that power; ``None`` when that side cannot reach it.
    One-sided tests use only their own direction's region on each side, as
    ``binomial_exact_power`` does.
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")
    if not 0.0 < target < 1.0:
        raise ValueError("the target power must be between 0 and 1")
    out: dict[str, tuple[float, float] | None] = {}
    for key, upper in (("up", True), ("down", False)):
        a, b = _tails(binomial_rejection_region(int(n), p0, alpha, tails, upper))
        out[key] = _side(int(n), a, b, p0, target, upper)
    return out
