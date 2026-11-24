"""Desirability for the prediction profiler (GAP_AUDIT_9 G7, optional part).

One response, one goal (maximise, minimise or hit a target). The desirability
``d`` maps a predicted response ``y`` onto [0, 1] with the simple Derringer and
Suich (1980, J. Quality Technology 12:214) one-sided / two-sided linear forms,
the family JMP's Prediction Profiler uses for its desirability functions
(https://www.jmp.com/support/help/en/18.1/jmp/desirability-profiling-and-optimization.shtml):

* maximise: 0 at or below ``lower``, 1 at or above ``upper``;
* minimise: 1 at or below ``lower``, 0 at or above ``upper``;
* target: 0 outside [``lower``, ``upper``], 1 at ``target``, linear between.

Provisional, owner to confirm: linear shapes only (JMP's exponent / "importance"
and the multi-response geometric mean are not offered), and the search is a
plain grid over the factor ranges, not JMP's Maximize Desirability gradient
optimiser. ``d`` is evaluated on the predicted MEAN.

:func:`maximize_desirability` evaluates the model on the product grid of every
continuous factor (evenly spaced over its range) and every nominal level, via
:func:`quantized.calc.stats_linear_model.predict`, and returns the best row.
Ties (a plateau of ``d == 1``) are broken toward the more extreme response for
maximise / minimise and the closer-to-target response for target, then by grid
order, so the answer is deterministic.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats_linear_model import predict
from quantized.calc.stats_lm_design import CONTINUOUS, spec_from_dict

GOALS = ("maximize", "minimize", "target")
#: Hard cap on grid points per search (one vectorised predict call).
MAX_GRID_POINTS = 60000
#: Per-factor grid points never exceed this.
MAX_PER_FACTOR = 41


def validate_goal(
    goal: str, lower: float, upper: float, target: float | None
) -> tuple[str, float, float, float | None]:
    if goal not in GOALS:
        raise ValueError(f"goal must be one of {', '.join(GOALS)}")
    if not (math.isfinite(lower) and math.isfinite(upper) and lower < upper):
        raise ValueError("desirability needs finite limits with lower < upper")
    if goal == "target" and not (target is not None and lower < target < upper):
        raise ValueError("a target goal needs lower < target < upper")
    return goal, float(lower), float(upper), None if target is None else float(target)


def desirability(
    y: Sequence[float] | NDArray[np.float64],
    goal: str,
    lower: float,
    upper: float,
    target: float | None = None,
) -> NDArray[np.float64]:
    """Desirability of each response value (see module docstring)."""
    goal, lower, upper, target = validate_goal(goal, lower, upper, target)
    v = np.asarray(y, dtype=float)
    if goal == "maximize":
        d = (v - lower) / (upper - lower)
    elif goal == "minimize":
        d = (upper - v) / (upper - lower)
    else:
        assert target is not None
        d = np.where(v <= target, (v - lower) / (target - lower), (upper - v) / (upper - target))
    return np.asarray(np.clip(d, 0.0, 1.0), dtype=float)


def _preference(y: NDArray[np.float64], goal: str, target: float | None) -> NDArray[np.float64]:
    """Larger is better; consulted only among rows with equal ``d``."""
    if goal == "maximize":
        return y
    if goal == "minimize":
        return np.asarray(-y, dtype=float)
    assert target is not None
    return np.asarray(-np.abs(y - target), dtype=float)


def maximize_desirability(
    model: Mapping[str, Any],
    ranges: Mapping[str, tuple[float, float]],
    goal: str,
    lower: float,
    upper: float,
    target: float | None = None,
) -> dict[str, Any]:
    """Grid search for the factor settings with the highest desirability.

    ``ranges`` gives (lo, hi) for every continuous factor the model uses.
    Nominal factors are searched over every fitted level.
    """
    goal, lower, upper, target = validate_goal(goal, lower, upper, target)
    spec = spec_from_dict(model)
    used = [f for f in spec.factors if any(f.name in t for t in spec.terms)]
    nominal = [f for f in used if f.kind != CONTINUOUS]
    cont = [f for f in used if f.kind == CONTINUOUS]
    combos = math.prod(len(f.levels) for f in nominal)
    if combos > MAX_GRID_POINTS:
        raise ValueError(f"{combos} level combinations exceed the {MAX_GRID_POINTS}-point cap")
    per = MAX_PER_FACTOR
    if cont:
        per = min(MAX_PER_FACTOR, int((MAX_GRID_POINTS / combos) ** (1.0 / len(cont))))
        if per < 3:
            raise ValueError("too many factors for the grid search; remove terms or fix a factor")
    axes: list[list[Any]] = []
    for f in used:
        if f.kind == CONTINUOUS:
            lo, hi = ranges[f.name]
            axes.append([float(v) for v in np.linspace(lo, hi, per)])
        else:
            axes.append(list(f.levels))
    rows = list(itertools.product(*axes))
    pred = predict(model, {f.name: [r[i] for r in rows] for i, f in enumerate(used)})
    y = np.asarray(pred["predicted"], dtype=float)
    se = np.asarray(pred["se_mean"], dtype=float)
    d = desirability(y, goal, lower, upper, target)
    pref = _preference(y, goal, target)
    top = np.flatnonzero(d == d.max())
    best = int(top[int(np.argmax(pref[top]))])  # argmax returns the first of equal maxima
    return {
        "settings": {f.name: rows[best][i] for i, f in enumerate(used)},
        "predicted": float(y[best]), "se_mean": float(se[best]),
        "desirability": float(d[best]), "n_evaluated": len(rows),
        "goal": goal, "lower": lower, "upper": upper, "target": target,
    }
