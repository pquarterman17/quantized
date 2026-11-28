"""A system of N equations in N unknowns (``scipy.optimize.root``).

Each equation is text in the fit-equation language, ``lhs = rhs`` (or a bare
expression meaning ``= 0``): ``x^2 + y^2 = 4`` and ``y = exp(-x)``. Every free
name that is not in ``constants`` is an unknown and needs a starting value in
``guess``; the number of equations must equal the number of unknowns (fewer or
more is refused, naming the unknowns). The result reports the point, the
residual of every equation, the residual 2-norm, and whether the solver
converged: ``converged`` needs both the solver's own success flag AND a
residual norm below ``1e-8`` times the norm at the starting point (at least
1e-8), so a solver that stops on a flat spot is not reported as a solution.
A root-finder is local: another starting point can reach another root.

Pure layer; expressions never reach ``eval``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.optimize import root

from quantized.calc.math_relations import BIG, compile_relations, split_relation

__all__ = ["SystemResult", "solve_system"]

RESIDUAL_TOL = 1e-8


@dataclass(frozen=True)
class SystemResult:
    variables: list[str]
    point: list[float]
    residuals: list[float]
    residual_norm: float
    converged: bool
    message: str
    evaluations: int
    method: str


def solve_system(
    equations: Sequence[str],
    guess: Mapping[str, float],
    constants: Mapping[str, float] | None = None,
    *,
    method: Literal["hybr", "lm"] = "hybr",
) -> SystemResult:
    """Solve ``equations`` (N of them) for their N unknowns from ``guess``."""
    if method not in ("hybr", "lm"):
        raise ValueError("method must be hybr or lm")
    eqs = [e for e in equations if e.strip() != ""]
    if not eqs:
        raise ValueError("enter at least one equation")
    rels = [split_relation(e, allow=("=",)) for e in eqs]
    comp = compile_relations(rels, constants)
    names = comp.variables
    if len(names) != len(rels):
        raise ValueError(
            f"{len(rels)} equation(s) but {len(names)} unknown(s) ({', '.join(names) or 'none'}); "
            "a system needs as many equations as unknowns. Give a value to any name that is fixed."
        )
    missing = [n for n in names if n not in guess]
    extra = [k for k in guess if k not in names]
    if missing:
        raise ValueError(f"give a starting value for: {', '.join(missing)}")
    if extra:
        raise ValueError(f"{', '.join(extra)} is not an unknown of these equations")
    x0 = np.array([float(guess[n]) for n in names])
    if not np.all(np.isfinite(x0)):
        raise ValueError("every starting value must be a finite number")
    start = float(np.linalg.norm(comp.evaluate(x0)))
    if start >= BIG:
        raise ValueError("an equation is not finite at the starting point; choose another start")
    res = root(comp.evaluate, x0, method=method)
    point = np.asarray(res.x, dtype=float)
    resid = comp.evaluate(point)
    norm = float(np.linalg.norm(resid))
    ok = bool(res.success) and bool(np.all(np.isfinite(point))) and norm < BIG
    ok = ok and norm <= RESIDUAL_TOL * max(1.0, start)
    return SystemResult(
        names,
        [float(v) for v in point],
        [float(v) for v in resid],
        norm,
        ok,
        str(res.message),
        int(getattr(res, "nfev", 0)),
        method,
    )
