"""Resolve per-dataset model specs of a global-fit request (multi-output models).

Route-side glue for ``calc.global_multi_model``: turns each ``DatasetModelSpec``
(a registry model or a custom equation, plus optional own-order start, bounds
and holds) into a ``MemberModel``. No fitting logic lives here.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_equation import equation_model
from quantized.calc.fit_equation_init import auto_start
from quantized.calc.fit_models import FIT_MODELS, evaluate, with_domain_bounds
from quantized.calc.global_multi_model import MemberModel


def _side(
    v: list[float | None] | None, fill: float, n: int, side: str, i: int
) -> list[float] | None:
    if v is None:
        return None
    if len(v) != n:
        raise ValueError(
            f"dataset {i}: {side} must have {n} values (one per parameter), got {len(v)}")
    return [fill if b is None else float(b) for b in v]


def resolve_member(i: int, spec: Any, x: list[float], y: list[float]) -> MemberModel:
    """One dataset's ``MemberModel`` from its spec (``spec`` is a ``DatasetModelSpec``)."""
    if (spec.model is None) == (spec.equation is None):
        raise ValueError(f"dataset {i}: specify exactly one of model or equation")
    fixed = None if spec.fixed is None else [bool(f) for f in spec.fixed]
    if spec.model is not None:
        name = spec.model
        if name not in FIT_MODELS:
            raise ValueError(f"dataset {i}: unknown model: {name}")

        def reg(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
            return evaluate(name, xx, pp)

        names = [str(n) for n in FIT_MODELS[name]["paramNames"]]
        n = len(names)
        lower, upper = with_domain_bounds(
            name, _side(spec.lower, -math.inf, n, "lower", i),
            _side(spec.upper, math.inf, n, "upper", i))
        p0 = [float(v) for v in (spec.p0 if spec.p0 is not None else auto_guess(name, x, y))]
        return MemberModel(reg, names, p0, name, lower, upper, fixed)
    assert spec.equation is not None
    fcn, names = equation_model(spec.equation)
    if not names:
        raise ValueError(f"dataset {i}: equation has no free parameters to fit")
    n = len(names)
    lower = _side(spec.lower, -math.inf, n, "lower", i)
    upper = _side(spec.upper, math.inf, n, "upper", i)
    if spec.p0 is not None:
        p0 = [float(v) for v in spec.p0]
    else:
        p0 = auto_start(fcn, names, x, y, lower=lower, upper=upper, fixed=fixed or [False] * n)
    return MemberModel(fcn, names, p0, spec.equation, lower, upper, fixed)
