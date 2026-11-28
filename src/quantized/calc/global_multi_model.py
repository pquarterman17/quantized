"""Global fit with ONE MODEL PER DATASET (Origin's multi-output models).

Pure calc layer. Several dependent variables come from different equations that
share some parameters, e.g. ``y1 = A*exp(-x/tau)`` and ``y2 = B*(1 - exp(-x/tau))``
with ``tau`` common. ``global_curve_fit`` already takes one callable per dataset
but one parameter list for all of them; this module supplies the missing layer:

* The parameter space is the UNION of every model's parameter names (first
  appearance order). A union name that a dataset's model lacks is an ABSENT slot
  for that dataset: held, never optimised, never counted as free, and reported
  as NaN.
* A parameter is shared only when a constraint names it. The same name in two
  models is otherwise two independent per-dataset parameters.
* A constraint is refused, with the reason, when a dataset it lists has a model
  without that parameter (``validate_constraints``). There is no silent drop.
* Everything else (Nelder-Mead over the joint residual, errors from the joint
  Jacobian, held slots, weights) is ``global_curve_fit`` itself, so the joint fit
  is the same estimator as the single-model path.

``joint_statistics`` gives the joint fit's chi-square, AIC, AICc and BIC from
``calc.fit_metrics.information_criteria`` -- the one convention every fitter uses.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .fit_metrics import information_criteria
from .global_curve_fit import global_curve_fit

__all__ = [
    "MemberModel",
    "global_fit_models",
    "joint_statistics",
    "union_names",
    "validate_constraints",
]

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


@dataclass
class MemberModel:
    """One dataset's model, with its start / bounds / holds in ITS OWN parameter order."""

    fcn: ModelFn
    names: list[str]
    p0: list[float]
    label: str = ""
    lower: list[float] | None = None  # None = unbounded on every parameter
    upper: list[float] | None = None
    fixed: list[bool] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def union_names(members: Sequence[MemberModel]) -> list[str]:
    """Every parameter name once, in order of first appearance."""
    return list(dict.fromkeys(n for m in members for n in m.names))


def validate_constraints(
    members: Sequence[MemberModel], constraints: Sequence[dict[str, Any]]
) -> None:
    """Refuse a sharing group naming a parameter that some listed dataset's model lacks."""
    union = union_names(members)
    k = len(members)
    for c in constraints:
        name = str(c["param_name"])
        if name not in union:
            raise ValueError(f'cannot share "{name}": no model has a parameter of that name '
                             f"(parameters: {', '.join(union)})")
        for d in sorted({int(d) for d in c["datasets"]}):
            if d < 0 or d >= k:
                raise ValueError(f"constraint dataset indices must be in [0, {k - 1}]")
            m = members[d]
            if name not in m.names:
                raise ValueError(
                    f'cannot share "{name}": dataset {d} uses model "{m.label}", which has no '
                    f'parameter "{name}" (its parameters: {", ".join(m.names)})')


def _check_member(i: int, m: MemberModel) -> None:
    n = len(m.names)
    if len(set(m.names)) != n:
        raise ValueError(f"dataset {i}: model {m.label!r} repeats a parameter name")
    for what, v in (("p0", m.p0), ("lower", m.lower), ("upper", m.upper), ("fixed", m.fixed)):
        if v is not None and len(v) != n:
            raise ValueError(f"dataset {i}: {what} must have {n} values (one per parameter of "
                             f"{m.label!r}), got {len(v)}")


def global_fit_models(
    datasets: list[Any],
    members: Sequence[MemberModel],
    constraints: Sequence[dict[str, Any]] | None,
    *,
    weights: Sequence[Any] | None = None,
    covariance: str = "jtj",
    max_iter: int = 20000,
    progress_callback: Callable[[float, str], None] | None = None,
    abort_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Jointly fit ``datasets[i]`` with ``members[i]`` (see the module doc).

    Returns ``global_curve_fit``'s result over the union ``paramNames``; a
    dataset's absent parameters are NaN in ``params`` / ``errors`` and listed
    nowhere in ``datasetParamNames[i]`` (its own parameters, own order).
    """
    k = len(datasets)
    if len(members) != k:
        raise ValueError(f"need one model per dataset: {k} datasets, {len(members)} models")
    for i, m in enumerate(members):
        _check_member(i, m)
    constraints = list(constraints or [])
    validate_constraints(members, constraints)

    union = union_names(members)
    p = len(union)
    cols = [[union.index(n) for n in m.names] for m in members]

    def widen(i: int, own: Sequence[float] | None, fill: float) -> list[float]:
        out = [fill] * p
        if own is not None:
            for j, c in enumerate(cols[i]):
                out[c] = float(own[j])
        return out

    p0 = [widen(i, m.p0, 0.0) for i, m in enumerate(members)]
    lower = [widen(i, m.lower, -math.inf) for i, m in enumerate(members)]
    upper = [widen(i, m.upper, math.inf) for i, m in enumerate(members)]
    present = np.zeros((k, p), dtype=bool)
    for i in range(k):
        present[i, cols[i]] = True
    fixed = np.zeros((k, p), dtype=bool)
    for i, m in enumerate(members):
        if m.fixed is not None:
            for j, c in enumerate(cols[i]):
                fixed[i, c] = bool(m.fixed[j])
    fixed |= ~present  # an absent slot has no effect on the residual: never optimise it

    def wrap(i: int) -> ModelFn:
        idx = np.asarray(cols[i], dtype=int)
        fcn = members[i].fcn

        def model(x: NDArray[np.float64], pu: NDArray[np.float64]) -> NDArray[np.float64]:
            return fcn(x, np.asarray(pu, dtype=float)[idx])

        return model

    out = global_curve_fit(
        datasets, [wrap(i) for i in range(k)], union, constraints,
        init_guess=p0, lower=lower, upper=upper, weights=weights, fixed=fixed.tolist(),
        covariance=covariance, max_iter=max_iter,
        progress_callback=progress_callback, abort_check=abort_check,
    )
    for key in ("params", "errors", "errorsJtj", "errorsHessian"):
        mat = np.asarray(out[key], dtype=float)
        mat[~present] = math.nan
        out[key] = mat.tolist()
    out["held"] = (np.asarray(out["held"], dtype=bool) & present).tolist()
    out["paramNames"] = union
    out["datasetParamNames"] = [list(m.names) for m in members]
    out["datasetModels"] = [m.label for m in members]
    return out


def joint_statistics(fit: dict[str, Any], weights: Sequence[Any] | None = None) -> dict[str, float]:
    """Joint-fit chi-square and information criteria of a ``global_curve_fit`` result.

    ``chiSqTotal`` is the weighted residual sum of squares the fit minimised;
    AIC / AICc / BIC use ``calc.fit_metrics.information_criteria`` with the
    fitted point count and the free-parameter count, and ``sum ln w`` over the
    fitted points when any dataset is weighted (as ``fit_metrics`` does).
    """
    chi_sq = float(np.sum(np.asarray(fit["chiSq"], dtype=float)))
    sum_log_w = 0.0
    if weights is not None:
        for w in weights:
            if w is not None:
                wv = np.asarray(w, dtype=float).ravel()
                sum_log_w += float(np.sum(np.log(wv[wv > 0])))
    ic = information_criteria(chi_sq, int(fit["nTotal"]), int(fit["nFree"]), sum_log_w)
    return {"chiSqTotal": chi_sq, "logLik": ic["logLik"], "AIC": ic["AIC"],
            "AICc": ic["AICc"], "BIC": ic["BIC"]}
