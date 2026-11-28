"""Minimise (or maximise) an expression under equality / inequality constraints.

The objective and every constraint are text in the fit-equation language
(:mod:`quantized.calc.math_relations`): constraints are ``lhs = rhs``,
``lhs <= rhs`` or ``lhs >= rhs``. Every free name that is not in ``constants``
is an unknown; ``guess`` gives the starting value of each (a name with finite
bounds and no guess starts at the middle of its bounds). ``bounds`` are
optional and may cover only some unknowns. ``method`` is SLSQP or
trust-constr (scipy).

With ``starts > 1`` (all unknowns need finite bounds) further starting points
are drawn from the box with a fixed seed. Candidates are ranked feasible first
(largest violation <= ``FEASIBLE_TOL``), then by objective value.

The result says, for every constraint, the value of ``lhs - rhs``, its slack
(inequalities: how far inside; negative means violated) and whether it is
ACTIVE at the solution: an equality always is, an inequality is when its slack
is within ``ACTIVE_TOL`` (1e-4, because trust-constr
stops a little inside) or ``ACTIVE_REL`` (0.1 %) of the problem's scale. Bounds
the solution sits within ``ACTIVE_REL`` of (of the bound's range or size) are
listed in ``at_bound``. ``converged`` needs the solver's success flag AND feasibility;
a local solver cannot prove a global optimum.

Pure layer; expressions never reach ``eval``.
"""

from __future__ import annotations

import warnings
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import BFGS, Bounds, NonlinearConstraint, minimize

from quantized.calc.math_relations import BIG, Relation, compile_relations, split_relation

__all__ = [
    "ACTIVE_REL",
    "ACTIVE_TOL",
    "FEASIBLE_TOL",
    "ConstrainedResult",
    "ConstraintStatus",
    "minimize_constrained",
]

FEASIBLE_TOL = 1e-6
ACTIVE_TOL = 1e-4  # trust-constr leaves ~1e-5 of interior-point slack on a binding inequality
ACTIVE_REL = 1e-3  # ... and up to ~2e-4 on a bound of 0.4, so the test also scales with the problem
_Arr = NDArray[np.float64]


@dataclass(frozen=True)
class ConstraintStatus:
    text: str
    kind: str  # "eq", "le" or "ge"
    value: float  # lhs - rhs at the solution
    slack: float | None  # inequalities only: >= 0 when satisfied
    satisfied: bool
    active: bool


@dataclass(frozen=True)
class ConstrainedResult:
    variables: list[str]
    point: list[float]
    value: float
    sense: str
    method: str
    converged: bool
    feasible: bool
    max_violation: float
    message: str
    constraints: list[ConstraintStatus]
    at_bound: list[str]
    starts: int
    starts_agreeing: int


def _slack(rel: Relation, value: float) -> float | None:
    if rel.op == "=":
        return None
    return -value if rel.op == "<=" else value


def _violation(rels: Sequence[Relation], d: _Arr) -> float:
    worst = 0.0
    for rel, v in zip(rels, d, strict=True):
        s = _slack(rel, float(v))
        worst = max(worst, abs(float(v)) if s is None else max(0.0, -s))
    return worst


def minimize_constrained(
    objective: str,
    constraints: Sequence[str] = (),
    *,
    bounds: Mapping[str, tuple[float, float]] | None = None,
    guess: Mapping[str, float] | None = None,
    constants: Mapping[str, float] | None = None,
    sense: Literal["min", "max"] = "min",
    method: Literal["SLSQP", "trust-constr"] = "SLSQP",
    starts: int = 1,
    seed: int = 0,
) -> ConstrainedResult:
    """Minimise (or maximise) ``objective`` subject to ``constraints``."""
    if sense not in ("min", "max"):
        raise ValueError("sense must be min or max")
    if method not in ("SLSQP", "trust-constr"):
        raise ValueError("method must be SLSQP or trust-constr")
    if not 1 <= starts <= 200:
        raise ValueError("starts must be between 1 and 200")
    if objective.strip() == "":
        raise ValueError("enter an expression to minimise")
    obj_rel = Relation(objective.strip(), "=", objective.strip(), "0")
    if any(op in objective for op in ("<=", ">=", "==")):
        raise ValueError("the expression to optimise is a value, not a relation")
    rels = [split_relation(c) for c in constraints if c.strip() != ""]
    comp = compile_relations([obj_rel, *rels], constants)
    names = comp.variables
    if not names:
        raise ValueError("there is no unknown to optimise")
    bounds = dict(bounds or {})
    guess = dict(guess or {})
    extra = [k for k in [*bounds, *guess] if k not in names]
    if extra:
        raise ValueError(f"no unknown named {', '.join(dict.fromkeys(extra))}")
    lo = np.array([bounds[n][0] if n in bounds else -np.inf for n in names], dtype=float)
    hi = np.array([bounds[n][1] if n in bounds else np.inf for n in names], dtype=float)
    if np.any(np.isnan(lo)) or np.any(np.isnan(hi)) or np.any(lo >= hi):
        raise ValueError("every bound needs a lower value below the upper one")
    x0 = np.empty(len(names))
    for k, n in enumerate(names):
        if n in guess:
            x0[k] = float(guess[n])
        elif np.isfinite(lo[k]) and np.isfinite(hi[k]):
            x0[k] = (lo[k] + hi[k]) / 2
        else:
            raise ValueError(f"give a starting value for {n} (or finite bounds for it)")
    if not np.all(np.isfinite(x0)):
        raise ValueError("every starting value must be a finite number")
    x0 = np.clip(x0, lo, hi)
    pts = [x0]
    if starts > 1:
        if not (np.all(np.isfinite(lo)) and np.all(np.isfinite(hi))):
            raise ValueError("extra starting points need finite bounds on every unknown")
        rng = np.random.default_rng(seed)
        pts += [lo + rng.random(lo.size) * (hi - lo) for _ in range(starts - 1)]

    sign = 1.0 if sense == "min" else -1.0
    eq_at = [k + 1 for k, r in enumerate(rels) if r.op == "="]
    in_at = [k + 1 for k, r in enumerate(rels) if r.op != "="]
    in_sign = np.array([-1.0 if rels[k - 1].op == "<=" else 1.0 for k in in_at])

    def fobj(v: _Arr) -> float:
        val = float(comp.evaluate(v)[0])
        return sign * val if abs(val) < BIG else BIG

    def f_eq(v: _Arr) -> _Arr:
        return np.asarray(comp.evaluate(v)[eq_at], dtype=float)

    def f_in(v: _Arr) -> _Arr:  # >= 0 when satisfied
        d = comp.evaluate(v)[in_at]
        return np.asarray(np.where(np.abs(d) >= BIG, -BIG, in_sign * d), dtype=float)

    runs: list[Any] = []
    for p0 in pts:
        if method == "SLSQP":
            cons: list[dict[str, Any]] = []
            if eq_at:
                cons.append({"type": "eq", "fun": f_eq})
            if in_at:
                cons.append({"type": "ineq", "fun": f_in})
            sl_bounds = [
                (None if np.isinf(a) else a, None if np.isinf(b) else b)
                for a, b in zip(lo, hi, strict=True)
            ]
            res = minimize(fobj, p0, method="SLSQP", bounds=sl_bounds, constraints=cons)
        else:
            tc: list[NonlinearConstraint] = []
            if eq_at:
                tc.append(NonlinearConstraint(f_eq, 0.0, 0.0, hess=BFGS()))
            if in_at:
                tc.append(NonlinearConstraint(f_in, 0.0, np.inf, hess=BFGS()))
            with warnings.catch_warnings():  # scipy nags about BFGS on linear problems
                warnings.simplefilter("ignore", UserWarning)
                res = minimize(
                    fobj,
                    p0,
                    method="trust-constr",
                    bounds=Bounds(lo, hi),
                    constraints=tc,
                    hess=BFGS(),
                )
        pt = np.clip(np.asarray(res.x, dtype=float), lo, hi)
        d = comp.evaluate(pt)
        runs.append((res, pt, d, _violation(rels, d[1:])))
    ok = [r for r in runs if np.all(np.isfinite(r[1])) and abs(float(r[2][0])) < BIG]
    if not ok:
        raise ValueError("the expression is not finite anywhere the optimiser looked")
    feas = [r for r in ok if r[3] <= FEASIBLE_TOL]

    def rank(r: Any) -> tuple[bool, float, float]:
        bad = r[3] > FEASIBLE_TOL
        return (bad, float(r[3]) if bad else 0.0, sign * float(r[2][0]))

    best = min(ok, key=rank)
    res, point, d, viol = best
    value = float(d[0])
    scale = max(1.0, abs(value))
    agree = sum(1 for r in feas if abs(float(r[2][0]) - value) <= 1e-6 * scale)
    status = []
    magnitude = max(1.0, float(np.max(np.abs(point))))
    for rel, v in zip(rels, d[1:], strict=True):
        slack = _slack(rel, float(v))
        sat = abs(float(v)) <= FEASIBLE_TOL if slack is None else slack >= -FEASIBLE_TOL
        active = True if slack is None else slack <= max(ACTIVE_TOL, ACTIVE_REL * magnitude)
        kind = {"=": "eq", "<=": "le", ">=": "ge"}[rel.op]
        status.append(ConstraintStatus(rel.text, kind, float(v), slack, bool(sat), bool(active)))
    span = np.where(np.isfinite(hi - lo), hi - lo, 1.0)
    on_bound = [
        n
        for n, v, a, b, s in zip(names, point, lo, hi, span, strict=True)
        if min(v - a, b - v) <= ACTIVE_REL * max(float(s), abs(float(v)))
    ]
    feasible = viol <= FEASIBLE_TOL
    return ConstrainedResult(
        names,
        [float(v) for v in point],
        value,
        sense,
        method,
        bool(res.success) and feasible,
        feasible,
        float(viol),
        str(res.message),
        status,
        on_bound,
        len(pts),
        int(agree),
    )
