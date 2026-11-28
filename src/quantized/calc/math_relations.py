"""Equations and constraints written as text, compiled over several unknowns.

The solver extras (:mod:`quantized.calc.math_system`,
:mod:`quantized.calc.math_constrained`) take relations such as ``x^2 + y^2 = 4``
or ``x + 2*y <= 3``. A relation is split at its top-level comparison (``=``,
``==``, ``<=`` or ``>=``; a comparison inside parentheses, as in
``if(x < 1, ...)``, is part of the expression) and compiled as the single
expression ``(lhs) - (rhs)`` through the existing equation language
(``calc.fit_equation.parse_equation``, a safe RPN interpreter, never ``eval``).
Every free name is an unknown unless it is given in ``constants``; ``x`` is an
ordinary unknown here. Strict ``<`` and ``>`` are refused (a minimiser cannot
tell them from the closed form, so they would only mislead).

Pure layer.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from quantized.calc.fit_equation import describe_equation, parse_equation

__all__ = ["BIG", "MAX_VARIABLES", "Compiled", "Relation", "compile_relations", "split_relation"]

MAX_VARIABLES = 12
BIG = 1e300
_Arr = NDArray[np.float64]
Op = Literal["=", "<=", ">="]


@dataclass(frozen=True)
class Relation:
    text: str
    op: Op
    lhs: str
    rhs: str

    @property
    def expression(self) -> str:
        return f"({self.lhs}) - ({self.rhs})"


def _two(text: str, i: int) -> Op | None:
    pair = text[i : i + 2]
    if pair == "<=":
        return "<="
    if pair == ">=":
        return ">="
    return "=" if pair == "==" else None


def split_relation(text: str, *, allow: tuple[Op, ...] = ("=", "<=", ">=")) -> Relation:
    """Split ``text`` at its top-level comparison. No comparison means ``= 0``."""
    shown = text.strip()
    depth = 0
    found: tuple[int, int, Op] | None = None
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and ch in "<>=!":
            op = _two(text, i)
            span = 2
            if op is None:
                if text[i : i + 2] == "!=":
                    raise ValueError(f'"{shown}": != is not a relation a solver can use')
                if ch != "=":
                    raise ValueError(f'"{shown}": use <= or >= (strict < and > are not supported)')
                op, span = "=", 1
            if found is not None:
                raise ValueError(f'"{shown}" has more than one comparison')
            found = (i, span, op)
            i += span
            continue
        i += 1
    if found is None:
        return Relation(shown, "=", shown, "0")
    at, span, op = found
    lhs, rhs = text[:at].strip(), text[at + span :].strip()
    if lhs == "" or rhs == "":
        raise ValueError(f'"{shown}" needs an expression on both sides of {op}')
    if op not in allow:
        raise ValueError(f'"{shown}": {op} is not allowed here')
    return Relation(shown, op, lhs, rhs)


@dataclass(frozen=True)
class Compiled:
    """Relations compiled over one list of unknowns.

    ``evaluate(v)`` returns ``lhs - rhs`` of every relation at the point ``v``
    (ordered as ``variables``); a value that is not finite becomes ``BIG``.
    """

    variables: list[str]
    constants: dict[str, float]
    evaluate: Callable[[_Arr], _Arr]


def compile_relations(
    relations: Sequence[Relation], constants: Mapping[str, float] | None = None
) -> Compiled:
    consts = {k: float(v) for k, v in (constants or {}).items()}
    if not all(np.isfinite(v) for v in consts.values()):
        raise ValueError("every constant must be a finite number")
    parsed = []
    names: list[str] = []
    uses_x = False
    for rel in relations:
        try:
            info = describe_equation(rel.expression)
            fcn, pnames = parse_equation(rel.expression)
        except ValueError as exc:
            raise ValueError(f'"{rel.text}": {exc}') from exc
        parsed.append((fcn, pnames, info.uses_x))
        uses_x = uses_x or info.uses_x
        names += [n for n in info.params if n not in names]
    all_names = (["x"] if uses_x else []) + names
    extra = [k for k in consts if k not in all_names]
    if extra:
        raise ValueError(f"no equation has a name {', '.join(extra)}")
    variables = [n for n in all_names if n not in consts]
    if len(variables) > MAX_VARIABLES:
        raise ValueError(f"at most {MAX_VARIABLES} unknowns are supported")

    def evaluate(v: _Arr) -> _Arr:
        env = dict(consts)
        env.update(zip(variables, (float(t) for t in v), strict=True))
        out = np.empty(len(parsed))
        for k, (fcn, pnames, ux) in enumerate(parsed):
            xv = np.array([env["x"] if ux else 0.0])
            p = np.array([env[n] for n in pnames], dtype=float)
            with np.errstate(all="ignore"):
                val = float(fcn(xv, p)[0])
            out[k] = val if np.isfinite(val) else BIG
        return out

    return Compiled(variables, consts, evaluate)
