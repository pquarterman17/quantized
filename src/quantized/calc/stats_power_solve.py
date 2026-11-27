"""Solve power, sample size or detectable effect for the common tests.

``solve`` takes one test and the three quantities power analysis juggles
(power, sample size, effect) and finds whichever one is left blank, given
``alpha`` and the sidedness. The forward power functions live in
``stats_power``; this module only searches over them (``scipy.optimize.brentq``)
so the three answers can never disagree.

* A sample size is rounded UP to a whole number, and the result always carries
  the power achieved at that whole number (it is at least the target).
* A two-sample or two-proportion test with ``ratio`` = n2 / n1 reports both
  group sizes (``n2 = ceil(ratio * n1)``) and the power at those integers.
* A detectable effect is the smallest effect (> 0) reaching the target power.
  Effects with a direction (a proportion, a variance ratio) also report the
  alternative on the other side (``effect_alt``, ``p1_alt``).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from scipy.optimize import brentq

from quantized.calc.stats_power import (
    anova_power,
    cohens_h,
    proportion_power,
    t_power,
    variance_power,
)

__all__ = ["SOLVE_FOR", "TESTS", "solve"]

TESTS = ("t-one-sample", "t-paired", "t-two-sample", "anova", "prop-one", "prop-two", "variance")
SOLVE_FOR = ("power", "n", "effect")
_MAX_N = 10_000_000
_MIN_N = 2
_TWO_GROUP = ("t-two-sample", "prop-two")
_EFFECT_NAME = {
    "t-one-sample": "Cohen's d",
    "t-paired": "Cohen's d",
    "t-two-sample": "Cohen's d",
    "anova": "Cohen's f",
    "prop-one": "Cohen's h",
    "prop-two": "Cohen's h",
    "variance": "variance ratio",
}
_TOO_BIG = "the required sample size exceeds 10 million: the effect is too small"

# power(n1, n2, effect); n2 is None for a single-group test
PowerFn = Callable[[float, float | None, float], float]


def _power_fn(test: str, alpha: float, tails: int, groups: int) -> PowerFn:
    if test.startswith("t-"):
        kind = test[2:]

        def t_fn(n: float, n2: float | None, e: float) -> float:
            return t_power(kind, e, n, alpha=alpha, tails=tails, n2=n2)

        return t_fn
    if test == "anova":

        def a_fn(n: float, _n2: float | None, e: float) -> float:
            return anova_power(e, n, groups, alpha=alpha)

        return a_fn
    if test.startswith("prop-"):

        def p_fn(n: float, n2: float | None, e: float) -> float:
            return proportion_power(e, n, alpha=alpha, tails=tails, n2=n2)

        return p_fn

    def v_fn(n: float, _n2: float | None, e: float) -> float:
        return variance_power(e, n, alpha=alpha, tails=tails)

    return v_fn


def _root(
    f: Callable[[float], float], lo: float, hi: float, grow: Callable[[float], float]
) -> float:
    """brentq on a bracket whose far end is widened until the sign changes."""
    flo = f(lo)
    for _ in range(80):
        if f(hi) * flo <= 0.0:
            return float(brentq(f, lo, hi, xtol=1e-12, rtol=1e-12, maxiter=500))
        hi = grow(hi)
    raise ValueError("no solution: the target power cannot be reached with these inputs")


def _second(n: float, ratio: float, two: bool) -> float | None:
    """The second group's size for a first group of ``n`` (whole numbers when ``n`` is whole)."""
    if not two:
        return None
    return float(max(_MIN_N, math.ceil(ratio * n - 1e-9))) if n == int(n) else ratio * n


def _n_for(fn: PowerFn, effect: float, target: float, ratio: float, two: bool) -> int:
    def f(n: float) -> float:
        return fn(n, None if not two else ratio * n, effect) - target

    if f(float(_MIN_N)) >= 0.0:
        n = _MIN_N
    else:
        hi = 8.0
        while f(hi) < 0.0:
            hi *= 2.0
            if hi > _MAX_N:
                raise ValueError(_TOO_BIG)
        n = max(
            _MIN_N, math.ceil(float(brentq(f, float(_MIN_N), hi, xtol=1e-9, maxiter=500)) - 1e-9)
        )
    # The continuous root is a start; settle on the least whole number that holds.
    while n > _MIN_N and fn(float(n - 1), _second(n - 1, ratio, two), effect) >= target:
        n -= 1
    while fn(float(n), _second(n, ratio, two), effect) < target:
        n += 1
        if n > _MAX_N:
            raise ValueError(_TOO_BIG)
    return n


def _effect_for(
    fn: PowerFn, test: str, n: float, n2: float | None, target: float
) -> tuple[float, float | None]:
    """The smallest effect reaching ``target``; a variance ratio also gives the side below 1."""

    def f(e: float) -> float:
        return fn(n, n2, e) - target

    if test == "variance":
        return _root(f, 1.0 + 1e-9, 2.0, lambda h: h * 2.0), _root(
            f, 1.0 - 1e-9, 0.5, lambda h: h / 2.0
        )
    return _root(f, 1e-9, 1.0, lambda h: h * 2.0), None


def _prop_ends(p0: float, h: float) -> tuple[float | None, float | None]:
    """The alternative proportions p1 at +h and -h from p0 (None where outside [0, 1])."""
    a = math.asin(math.sqrt(p0))
    up, down = a + h / 2.0, a - h / 2.0
    return (
        math.sin(up) ** 2 if up <= math.pi / 2.0 else None,
        math.sin(down) ** 2 if down >= 0.0 else None,
    )


def _need(name: str, value: float | None, ok: Callable[[float], bool], hint: str) -> float:
    if value is None:
        raise ValueError(f"{name} is required")
    if not math.isfinite(value) or not ok(value):
        raise ValueError(f"{name} must be {hint}")
    return float(value)


def solve(
    test: str,
    solve_for: str,
    *,
    alpha: float = 0.05,
    tails: int = 2,
    effect: float | None = None,
    p0: float | None = None,
    p1: float | None = None,
    n: int | None = None,
    power: float | None = None,
    ratio: float = 1.0,
    groups: int = 3,
) -> dict[str, Any]:
    """Solve one of power, sample size or effect for ``test``; see the module docstring.

    ``effect`` is Cohen's d (t), Cohen's f (anova) or the variance ratio
    sigma1^2/sigma0^2; the proportion tests take ``p0`` (baseline) and ``p1``
    instead. ``n`` is per group (the number of pairs for a paired test).
    """
    if test not in TESTS:
        raise ValueError(f"test must be one of {TESTS}, got {test!r}")
    if solve_for not in SOLVE_FOR:
        raise ValueError(f"solve must be one of {SOLVE_FOR}, got {solve_for!r}")
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    two = test in _TWO_GROUP
    if two and not (math.isfinite(ratio) and 0.05 <= ratio <= 20.0):
        raise ValueError("ratio n2/n1 must be between 0.05 and 20")
    if test == "anova" and not 2 <= groups <= 200:
        raise ValueError("groups must be between 2 and 200")
    is_prop = test.startswith("prop-")
    fn = _power_fn(test, alpha, tails, groups)
    out: dict[str, Any] = {
        "test": test,
        "solve": solve_for,
        "alpha": alpha,
        "tails": tails,
        "effect_name": _EFFECT_NAME[test],
        "ratio": ratio if two else 1.0,
        "groups": groups if test == "anova" else None,
        "p0": p0 if is_prop else None,
        "p1": None,
        "p1_alt": None,
        "effect_alt": None,
        "target_power": None,
        "notes": [],
    }
    if is_prop:
        _need("p0", p0, lambda v: 0.0 < v < 1.0, "strictly between 0 and 1")
    n_in: float | None = None
    if solve_for != "n":
        n_in = _need(
            "n",
            None if n is None else float(n),
            lambda v: v >= _MIN_N and v == int(v),
            f"a whole number >= {_MIN_N}",
        )
    target: float | None = None
    if solve_for != "power":
        target = _need(
            "power", power, lambda v: alpha < v < 1.0, "greater than alpha and less than 1"
        )
    eff_in: float | None = None
    if solve_for != "effect":
        if is_prop:
            eff_in = cohens_h(
                _need("p1", p1, lambda v: 0.0 <= v <= 1.0, "between 0 and 1"), float(p0 or 0.0)
            )
            if eff_in == 0.0:
                raise ValueError("p1 equals p0: there is no effect to detect")
        elif test == "variance":
            eff_in = _need("effect", effect, lambda v: v > 0.0 and v != 1.0, "positive and not 1")
        else:
            eff_in = _need("effect", effect, lambda v: v != 0.0, "nonzero")
    if solve_for == "n":
        assert eff_in is not None and target is not None
        n1, eff = _n_for(fn, eff_in, target, ratio, two), eff_in
    elif solve_for == "power":
        assert n_in is not None and eff_in is not None
        n1, eff = int(n_in), eff_in
    else:
        assert n_in is not None and target is not None
        n1 = int(n_in)
        eff, out["effect_alt"] = _effect_for(fn, test, float(n1), _second(n1, ratio, two), target)
    n2 = _second(n1, ratio, two)
    out.update(
        n=n1,
        n2=None if n2 is None else int(n2),
        effect=eff,
        target_power=target,
        n_total=n1 * groups if test == "anova" else n1 + int(n2) if n2 is not None else n1,
        power=fn(float(n1), n2, eff),
    )
    if is_prop:
        if solve_for == "effect":
            out["p1"], out["p1_alt"] = _prop_ends(float(p0 or 0.0), eff)
            out["effect_alt"] = None
        else:
            out["p1"] = p1
    if tails == 1 and test != "variance":
        out["notes"].append("One-sided: assumes the effect lies in the direction tested.")
    if is_prop:
        out["notes"].append(
            "Normal approximation (arcsine, Cohen's h); optimistic below about n*p = 10."
        )
    if test == "variance" and tails == 1:
        out["notes"].append("One-sided: a ratio above 1 tests an increase, below 1 a decrease.")
    out["curve"] = _curve(fn, n1, eff, ratio, two)
    return out


def _curve(fn: PowerFn, n: int, eff: float, ratio: float, two: bool) -> dict[str, list[float]]:
    """Power against n (per group) around the answer, at the same effect."""
    lo = max(_MIN_N, n // 4)
    hi = max(2 * n, n + 10)
    ns = sorted({*range(lo, hi + 1, max(1, (hi - lo) // 40)), n})
    return {
        "n": [float(v) for v in ns],
        "power": [fn(float(v), _second(v, ratio, two), eff) for v in ns],
    }
