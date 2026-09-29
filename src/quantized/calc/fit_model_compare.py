"""Fit several models to one selection and compare them (Curve Fit "Compare").

Pure calc layer, no new fitting or statistics math. Every candidate runs
through the same engines as the AICc quick-scan (``calc.fit_scan``'s registry
and custom-equation runners, i.e. the ``/api/fitting/fit`` and
``/equation/fit`` paths), unweighted. The metrics are
``calc.fit_stats.fit_compare`` (the golden port of MATLAB ``fitCompare``) on
each fit's residuals: R², adjusted R², AIC/AICc/BIC, RMSE, plus the nested
F-test against one REFERENCE candidate. What this module adds is only the
bookkeeping: deltas vs the best candidate and the choice of reference.

The F-test is meaningful only when the reference is NESTED in the other model
(e.g. Linear inside Quadratic). ``fit_compare`` checks only that the
reference has fewer parameters; nesting itself is the caller's to judge, so
the UI labels the column accordingly.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.fit_scan import _equation_runner, _registry_runner
from quantized.calc.fit_stats import fit_compare

__all__ = ["compare_models"]

_METRICS = ("R2", "adjR2", "aic", "aicc", "bic", "rmse", "fStat", "fPvalue")
_DELTAS = (("aic", "dAIC"), ("aicc", "dAICc"), ("bic", "dBIC"))


def _fit_one(
    name: str,
    kind: str,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    equation: str = "",
    guesses: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Fit one candidate; a failure becomes an error entry, never an abort."""
    try:
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            if kind == "registry":
                result, names = _registry_runner(name, xv, yv, None)
            else:
                result, names = _equation_runner(equation, guesses, xv, yv, None)
    except Exception as exc:  # per-candidate containment, as in fit_scan
        empty = dict.fromkeys(_METRICS)
        return {"name": name, "kind": kind, "error": str(exc), "k": None, "params": None,
                "paramNames": None, "chiSqRed": None, "_res": None, **empty,
                **{d: None for _, d in _DELTAS}}
    return {
        "name": name,
        "kind": kind,
        "error": None,
        "k": int(result["nFree"]),
        "params": [float(v) for v in np.asarray(result["params"], dtype=float)],
        "paramNames": names,
        "chiSqRed": float(result["chiSqRed"]),
        "_res": np.asarray(result["residuals"], dtype=float),
    }


def _pick_reference(ok: list[dict[str, Any]], reference: str | None) -> dict[str, Any] | None:
    if reference is not None:
        for e in ok:
            if e["name"] == reference:
                return e
        return None
    return min(ok, key=lambda e: int(e["k"])) if ok else None


def compare_models(
    x: ArrayLike,
    y: ArrayLike,
    *,
    models: Sequence[str] | None = None,
    equations: Sequence[dict[str, Any]] | None = None,
    reference: str | None = None,
) -> dict[str, Any]:
    """Fit every candidate to (x, y) and compare with ``fit_compare``.

    ``models`` are registry names; ``equations`` are ``{"name", "equation",
    "guesses"?}`` custom candidates. At least two candidates are required.
    ``reference`` names the F-test baseline; ``None`` picks the successful
    candidate with the fewest free parameters (first listed on a tie).

    Returns ``{"n", "reference", "results"}``; results keep the input order
    (registry models, then equations). Each entry has ``name/kind/error/k/
    params/paramNames/chiSqRed`` plus ``R2/adjR2/aic/aicc/bic/rmse`` and
    ``fStat/fPvalue`` (vs the reference; NaN for the reference itself or a
    candidate that is not larger than it) and ``dAIC/dAICc/dBIC`` (vs the
    lowest value among successful fits). Failed fits carry ``error`` and
    null metrics.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    eq_list = list(equations or [])
    names = list(models or [])
    if len(names) + len(eq_list) < 2:
        raise ValueError("compare needs at least 2 candidate models")
    if xv.size < 3:
        raise ValueError("need at least 3 points to compare models")

    entries = [_fit_one(n, "registry", xv, yv) for n in names]
    for eq in eq_list:
        label = str(eq.get("name", "") or eq.get("equation", ""))
        entries.append(
            _fit_one(label, "equation", xv, yv, str(eq.get("equation", "")), eq.get("guesses"))
        )
    ok = [e for e in entries if e["error"] is None]
    ref = _pick_reference(ok, reference)
    if reference is not None and ref is None:
        raise ValueError(f"reference {reference!r} is not a successfully fitted candidate")

    for e in ok:
        kw: dict[str, Any] = {}
        if ref is not None and e is not ref:
            kw = {"resid_ref": ref["_res"], "n_params_ref": float(ref["k"])}
        metrics = fit_compare(yv, e["_res"], int(e["k"]), **kw)
        e.update({k: metrics[k] for k in _METRICS})
    for key, dkey in _DELTAS:
        finite = [float(e[key]) for e in ok if math.isfinite(float(e[key]))]
        best = min(finite) if finite else math.nan
        for e in ok:
            e[dkey] = float(e[key]) - best
    for e in entries:
        del e["_res"]
    return {"n": int(xv.size), "reference": ref["name"] if ref else None, "results": entries}
