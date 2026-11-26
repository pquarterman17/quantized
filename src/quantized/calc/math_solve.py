"""A small equation / optimisation solver over the fit-equation language.

Expressions go through ``calc.fit_equation.parse_equation`` (a safe RPN
interpreter, never ``eval``), so they read like a fit model: ``x`` is the
variable, any other free name (``a``, ``k``...) is a named quantity.

* :func:`solve_root` finds every root of ``f(x) = target`` inside ``[lo, hi]``.
  The interval is scanned on ``scan`` equal steps; each sign change is refined
  with Brent's method. A sign change across a pole (``1/x`` through 0) is NOT a
  root and is discarded (the residual at the refined point must be small). Every
  other name must be given a value in ``constants`` (an unknown or missing name
  is refused, which catches a typo rather than solving the wrong problem).
* :func:`optimize_box` minimises (or maximises) the expression over a box: every
  name the expression uses, ``x`` included, is a variable and needs bounds. It
  runs bounded L-BFGS-B from the box centre and from ``starts - 1`` seeded
  random points (fixed seed, so a rerun gives the same answer) and keeps the
  best. A non-finite value counts as infinitely bad. The result carries the
  count of starts that reached a point within tolerance of the best, as a hint
  of how rugged the surface is. It is a local optimiser with restarts, not a
  global-optimality proof.

Pure layer.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import brentq, minimize

from quantized.calc.fit_equation import describe_equation, parse_equation

__all__ = ["MAX_VARIABLES", "OptimumResult", "RootsResult", "optimize_box", "solve_root"]

MAX_VARIABLES = 12
_Arr = NDArray[np.float64]


@dataclass(frozen=True)
class RootsResult:
    roots: list[float]
    residuals: list[float]
    scanned: int
    poles_discarded: int


@dataclass(frozen=True)
class OptimumResult:
    variables: list[str]
    point: list[float]
    value: float
    sense: str
    converged: bool
    starts: int
    starts_agreeing: int
    at_bound: list[str]


def _check_finite(**vals: float) -> None:
    for name, v in vals.items():
        if not np.isfinite(v):
            raise ValueError(f"{name} must be a finite number")


def solve_root(
    expr: str,
    lo: float,
    hi: float,
    constants: Mapping[str, float] | None = None,
    *,
    target: float = 0.0,
    scan: int = 512,
    max_roots: int = 50,
) -> RootsResult:
    """Every root of ``expr(x) = target`` in ``[lo, hi]``."""
    _check_finite(lo=lo, hi=hi, target=target)
    if not lo < hi:
        raise ValueError("the bracket must have lo < hi")
    if not 8 <= scan <= 100_000:
        raise ValueError("the scan must use between 8 and 100,000 steps")
    info = describe_equation(expr)
    if not info.uses_x:
        raise ValueError("the expression does not use x, so there is nothing to solve for")
    consts = dict(constants or {})
    missing = [p for p in info.params if p not in consts]
    extra = [k for k in consts if k not in info.params]
    if missing:
        raise ValueError(f"give a value for: {', '.join(missing)}")
    if extra:
        raise ValueError(f"the expression has no name {', '.join(extra)}")
    _check_finite(**{k: float(v) for k, v in consts.items()})
    fcn, names = parse_equation(expr)
    p = np.array([float(consts[n]) for n in names], dtype=float)

    def f(x: float) -> float:
        with np.errstate(all="ignore"):
            return float(fcn(np.array([x]), p)[0]) - target

    xs = np.linspace(lo, hi, int(scan) + 1)
    with np.errstate(all="ignore"):
        fs = np.asarray(fcn(xs, p), dtype=float) - target
    finite_max = float(np.max(np.abs(fs[np.isfinite(fs)]))) if np.isfinite(fs).any() else 0.0
    tol = 1e-6 * max(1.0, finite_max)
    roots: list[float] = []
    resid: list[float] = []
    poles = 0
    for i in range(xs.size - 1):
        a, b = fs[i], fs[i + 1]
        if not (np.isfinite(a) and np.isfinite(b)):
            continue
        if a == 0.0:
            r = float(xs[i])
        elif a * b < 0:
            r = float(
                brentq(f, xs[i], xs[i + 1], xtol=1e-14, rtol=4 * np.finfo(float).eps, maxiter=200)
            )
        elif i == xs.size - 2 and b == 0.0:
            r = float(xs[-1])
        else:
            continue
        fr = f(r)
        if not np.isfinite(fr) or abs(fr) > tol:
            poles += 1
            continue
        if not roots or abs(r - roots[-1]) > 1e-12 * max(1.0, abs(r)):
            roots.append(r)
            resid.append(fr)
        if len(roots) >= max_roots:
            break
    if not roots:
        raise ValueError(
            f"no sign change of the expression was found in [{lo:g}, {hi:g}]"
            + (f" ({poles} jump(s) across a pole were ignored)" if poles else "")
            + "; widen the bracket"
        )
    return RootsResult(roots, resid, int(scan), poles)


def optimize_box(
    expr: str,
    bounds: Mapping[str, tuple[float, float]],
    *,
    sense: Literal["min", "max"] = "min",
    starts: int = 8,
    seed: int = 0,
) -> OptimumResult:
    """Minimise (or maximise) ``expr`` over the box given by ``bounds``."""
    if sense not in ("min", "max"):
        raise ValueError("sense must be min or max")
    if not 1 <= starts <= 200:
        raise ValueError("starts must be between 1 and 200")
    info = describe_equation(expr)
    names = (["x"] if info.uses_x else []) + list(info.params)
    if not names:
        raise ValueError("the expression has no variable to optimise")
    if len(names) > MAX_VARIABLES:
        raise ValueError(f"at most {MAX_VARIABLES} variables are supported")
    missing = [n for n in names if n not in bounds]
    extra = [k for k in bounds if k not in names]
    if missing:
        raise ValueError(f"give bounds for: {', '.join(missing)}")
    if extra:
        raise ValueError(f"the expression has no variable {', '.join(extra)}")
    lo = np.array([bounds[n][0] for n in names], dtype=float)
    hi = np.array([bounds[n][1] for n in names], dtype=float)
    if not (np.all(np.isfinite(lo)) and np.all(np.isfinite(hi))) or np.any(lo >= hi):
        raise ValueError("every variable needs finite bounds with lower < upper")
    fcn, pnames = parse_equation(expr)
    sign = 1.0 if sense == "min" else -1.0
    x_at = names.index("x") if info.uses_x else -1
    p_idx = [names.index(n) for n in pnames]

    def objective(v: _Arr) -> float:
        xv = np.array([v[x_at] if x_at >= 0 else 0.0])
        p = v[p_idx] if p_idx else np.zeros(0)
        with np.errstate(all="ignore"):
            val = float(fcn(xv, p)[0])
        return sign * val if np.isfinite(val) else 1e300

    rng = np.random.default_rng(seed)
    pts = [(lo + hi) / 2] + [lo + rng.random(lo.size) * (hi - lo) for _ in range(starts - 1)]
    runs = [
        minimize(objective, p0, method="L-BFGS-B", bounds=list(zip(lo, hi, strict=True)))
        for p0 in pts
    ]
    ok = [r for r in runs if r.fun < 1e299]
    if not ok:
        raise ValueError("the expression is not finite anywhere the optimiser looked in the box")
    best = min(ok, key=lambda r: r.fun)
    scale = max(1.0, abs(float(best.fun)))
    agree = sum(1 for r in ok if abs(r.fun - best.fun) <= 1e-6 * scale)
    point = np.clip(best.x, lo, hi)
    span = hi - lo
    on_bound = [
        n
        for n, v, a, b, s in zip(names, point, lo, hi, span, strict=True)
        if min(v - a, b - v) <= 1e-9 * s
    ]
    return OptimumResult(
        names,
        [float(v) for v in point],
        sign * float(best.fun),
        sense,
        bool(best.success),
        len(pts),
        int(agree),
        on_bound,
    )
