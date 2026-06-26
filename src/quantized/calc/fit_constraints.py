"""Constraint expansion for linked/constrained curve-fit parameters.

Port of ``fitting.applyConstraints``. Pure: free-parameter values + per-parameter
constraint expressions → the full parameter vector. Constraint expressions are
evaluated with the safe equation parser (``calc.fit_equation.parse_equation``, no
``eval``). A parameter is *free* when its constraint string is empty, else it is
*computed* from the free parameters.

Within an expression, free parameters may be referenced as ``p1..pK`` (the 1-based
position among ALL parameters, rewritten to free-local indices here) or by name.

Faithful-to-MATLAB note: ``parse_equation`` indexes parameters by order of
appearance, and ``applyConstraints`` rewrites references with two sequential regex
passes (named, then positional). Both behaviours are replicated exactly, so the
result matches MATLAB even in the corner cases its rewrite does not fully
normalise (mixed/reindexed references).
"""

from __future__ import annotations

import re

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .fit_equation import parse_equation

__all__ = ["apply_constraints"]


def _rewrite_constraint_expr(expr: str, all_names: list[str], free_idx: list[int]) -> str:
    """Rewrite param references to free-local ``p1..pK`` indices (port of
    rewriteConstraintExpr): named refs first (longest first), then positional
    ``p<global>``. Sequential, like MATLAB — do not reorder."""
    m = len(all_names)
    g2l = {gi: li + 1 for li, gi in enumerate(free_idx)}  # global → local (1-based)

    # 1) named references, longest names first (stable for ties, as MATLAB sort)
    for gi in sorted(range(m), key=lambda i: len(all_names[i]), reverse=True):
        if gi not in g2l or not all_names[gi]:
            continue
        pat = r"(?<![A-Za-z0-9_])" + re.escape(all_names[gi]) + r"(?![A-Za-z0-9_])"
        expr = re.sub(pat, f"p{g2l[gi]}", expr)

    # 2) positional p<global 1-based> → p<local> (after names, ascending global)
    for gi in range(m):
        if gi not in g2l:
            continue
        pat = r"(?<![A-Za-z0-9_])p" + str(gi + 1) + r"(?![0-9])"
        expr = re.sub(pat, f"p{g2l[gi]}", expr)

    return expr


def apply_constraints(
    p_free: ArrayLike,
    constraints: list[str],
    all_param_names: list[str],
) -> tuple[NDArray[np.float64], list[int]]:
    """Expand free parameters to the full vector using constraint expressions.

    Port of ``fitting.applyConstraints``. ``constraints[i]`` is ``""`` for a free
    parameter or an expression for a computed one. Returns ``(p_full, free_idx)``
    where ``free_idx`` are the 0-based positions of the free parameters (MATLAB
    returns 1-based). Raises ``ValueError`` on size mismatch, when a constraint
    references another constrained parameter, or on parse/eval failure.
    """
    pf = np.asarray(p_free, dtype=float).ravel()
    m = len(constraints)
    if len(all_param_names) != m:
        raise ValueError("constraints and all_param_names must have the same length")

    is_constrained = [bool(c.strip()) for c in constraints]
    free_idx = [i for i in range(m) if not is_constrained[i]]
    k = len(free_idx)
    if k == 0 and pf.size:
        raise ValueError(
            f"all {m} parameters are constrained — p_free must be empty when nothing is free"
        )
    if pf.size != k:
        raise ValueError(f"p_free has {pf.size} elements but {k} free parameters found")

    p_full = np.full(m, np.nan)
    for li, gi in enumerate(free_idx):
        p_full[gi] = pf[li]

    constrained_names = [all_param_names[i] for i in range(m) if is_constrained[i]]
    for kk in range(m):
        expr = constraints[kk].strip()
        if not expr:
            continue
        rewritten = _rewrite_constraint_expr(expr, all_param_names, free_idx)

        # A residual constrained-name reference means a constraint depends on a
        # non-free parameter — unsupported (would be circular).
        for nm in constrained_names:
            if not nm:
                continue
            if re.search(r"(?<![A-Za-z0-9_])" + re.escape(nm) + r"(?![A-Za-z0-9_])", rewritten):
                raise ValueError(
                    f'constraint for "{all_param_names[kk]}" references "{nm}" which is '
                    f"itself constrained; only free parameters may appear in constraints"
                )

        try:
            fcn, _ = parse_equation(rewritten)
            val = fcn(0.0, pf)
        except Exception as exc:
            raise ValueError(
                f'failed to evaluate constraint for "{all_param_names[kk]}" ("{expr}"): {exc}'
            ) from exc
        p_full[kk] = float(np.asarray(val, dtype=float).ravel()[0])

    return p_full, free_idx
