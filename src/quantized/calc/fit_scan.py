"""AICc model quick-scan: fit a candidate set, rank by small-sample AIC (GOTO #6).

Pure calc layer. New capability (no MATLAB original) but ZERO new fitting math:
every candidate runs through the existing engines — registry models via
``calc.fitting.curve_fit`` with the ``FIT_MODELS`` evaluator + bounds +
``auto_guess`` seed (the same path as ``POST /api/fitting/fit``), and custom
equation strings via ``calc.fit_equation.equation_model`` into the same
``curve_fit`` (the ``POST /api/fitting/equation/fit`` path). Each individual
scan fit therefore matches what the fit workshop would produce for that model.

Ranking: AICc = AIC + 2k(k+1)/(n-k-1), the small-sample correction of the
Gaussian-log-likelihood AIC already computed by ``curve_fit`` (k = free
parameter count). Results also carry delta-AICc (vs the best candidate) and
Akaike weights w_i = exp(-delta_i/2) / sum_j exp(-delta_j/2) — the standard
"probability this is the best of the set" reading (Burnham & Anderson 2002).

Per-candidate failures NEVER abort the scan — a model that cannot fit the
data is itself a scan result. Failed candidates carry an ``error`` string and
sort after every successful fit.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_equation import default_guesses, equation_model
from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fitting import curve_fit, weights_from_dy

__all__ = ["aicc_from_aic", "default_candidates", "scan_models"]

# One candidate's fit runner: () -> (curve_fit result, param names).
_Runner = Callable[[], tuple[dict[str, Any], list[str]]]


def aicc_from_aic(aic: float, k: int, n: int) -> float:
    """Small-sample corrected AIC: ``AICc = AIC + 2k(k+1)/(n-k-1)``.

    Guard: when ``n - k - 1 <= 0`` the correction divides by zero or flips
    sign (which would REWARD over-parameterization); return ``+inf`` so such
    a model ranks last — exactly the correction's intent.
    """
    dof = n - k - 1
    if dof <= 0:
        return math.inf
    return aic + 2.0 * k * (k + 1) / dof


def default_candidates(n_points: int) -> list[str]:
    """Registry models eligible for the default scan: ``nParams < n/3``.

    Every ``FIT_MODELS`` entry is a single-curve evaluator ``f(x, p) -> y``
    (that is the registry's contract), so "single-curve" is registry
    membership itself. The ``n/3`` cut requires at least ~3 points per
    parameter: below that a fit is barely constrained, the AICc denominator
    ``n - k - 1`` gets small and the correction noisy, and scan time is
    wasted on models the data cannot distinguish anyway.
    """
    return [name for name, spec in FIT_MODELS.items() if spec["nParams"] < n_points / 3]


def _registry_runner(
    name: str,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    weights: NDArray[np.float64] | None,
) -> tuple[dict[str, Any], list[str]]:
    spec = FIT_MODELS.get(name)
    if spec is None:
        raise ValueError(f"unknown model: {name}")

    def model_fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(spec["fcn"](xx, pp), dtype=float)

    try:
        p0 = list(auto_guess(name, xv, yv))
    except Exception:  # heuristics can fail on odd data; the registry default still fits
        p0 = list(spec["p0"])
    result = curve_fit(
        xv, yv, model_fcn, p0, lower=spec["lb"], upper=spec["ub"], weights=weights
    )
    return result, list(spec["paramNames"])


def _equation_runner(
    equation: str,
    guesses: Sequence[float] | None,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    weights: NDArray[np.float64] | None,
) -> tuple[dict[str, Any], list[str]]:
    fcn, names = equation_model(equation)
    if not names:
        raise ValueError("equation has no free parameters to fit")
    p0 = list(guesses) if guesses is not None else default_guesses(names)
    if len(p0) != len(names):
        raise ValueError(f"expected {len(names)} guesses, got {len(p0)}")
    result = curve_fit(xv, yv, fcn, p0, weights=weights)
    return result, names


def _run_candidate(name: str, kind: str, runner: _Runner, n: int) -> dict[str, Any]:
    """Fit one candidate; a failure becomes an error ENTRY, never an abort."""
    try:
        # A scan deliberately fits implausible models (e.g. Arrhenius across
        # x <= 0): numpy overflow/invalid warnings there are expected noise,
        # and a diverged fit simply ranks last. Silence them per-candidate.
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            result, param_names = runner()
    except Exception as exc:  # per-candidate containment (see module docstring)
        return {
            "name": name, "kind": kind, "error": str(exc),
            "k": None, "params": None, "paramNames": None,
            "R2": None, "RMSE": None, "AIC": None, "AICc": None,
            "deltaAICc": None, "weight": None,
        }
    k = int(result["nFree"])
    aic = float(result["AIC"])
    return {
        "name": name,
        "kind": kind,
        "error": None,
        "k": k,
        "params": [float(v) for v in np.asarray(result["params"], dtype=float)],
        "paramNames": param_names,
        "R2": float(result["R2"]),
        "RMSE": float(result["RMSE"]),
        "AIC": aic,
        "AICc": aicc_from_aic(aic, k, n),
        "deltaAICc": None,  # filled in after the whole set is ranked
        "weight": None,
    }


def _aicc_key(entry: dict[str, Any]) -> float:
    """Sort key: AICc with NaN (pathological fits) demoted to +inf."""
    v = float(entry["AICc"])
    return math.inf if math.isnan(v) else v


def _rank(ok: list[dict[str, Any]]) -> None:
    """Sort successes ascending by AICc and fill deltaAICc + Akaike weights."""
    ok.sort(key=_aicc_key)
    if not ok:
        return
    best = _aicc_key(ok[0])
    if best == -math.inf:
        # Perfect fits (AIC -inf, e.g. an exact polynomial): deltas vs -inf are
        # ill-defined, so the perfect set shares the whole weight uniformly.
        perfect = sum(1 for e in ok if _aicc_key(e) == -math.inf)
        for e in ok:
            hit = _aicc_key(e) == -math.inf
            e["deltaAICc"] = 0.0 if hit else math.inf
            e["weight"] = 1.0 / perfect if hit else 0.0
        return
    if not math.isfinite(best):
        # Every survivor has AICc == +inf (n - k - 1 <= 0 for all of them,
        # e.g. a 3-point dataset scanned with only custom 2-param models):
        # AICc cannot discriminate, so share the weight uniformly like the
        # perfect-fit branch above (review 2026-07-11: inf - inf gave NaN
        # deltas and a 0.0/0.0 ZeroDivisionError -> HTTP 500).
        for e in ok:
            e["deltaAICc"] = 0.0
            e["weight"] = 1.0 / len(ok)
        return
    rel: list[float] = []
    for e in ok:
        delta = _aicc_key(e) - best
        e["deltaAICc"] = delta
        rel.append(math.exp(-delta / 2.0) if math.isfinite(delta) else 0.0)
    total = sum(rel)  # >= 1: the best candidate contributes exp(0)
    for e, r in zip(ok, rel, strict=True):
        e["weight"] = r / total


def scan_models(
    x: ArrayLike,
    y: ArrayLike,
    *,
    dy: ArrayLike | None = None,
    models: Sequence[str] | None = None,
    equations: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fit every candidate model to (x, y) and rank by AICc (ascending).

    ``models`` — registry model names; ``None`` selects the default set
    (``default_candidates``: every registry model with ``nParams < n/3``).
    ``equations`` — custom-equation candidates ``{"name", "equation",
    "guesses"?}`` (the saved custom fit models); guesses default to 1.0 each.
    ``dy`` — optional per-point 1-sigma errors -> weights ``1/dy**2``.

    Returns ``{"n", "nCandidates", "results"}`` where each result entry has
    ``name/kind/k/params/paramNames/R2/RMSE/AIC/AICc/deltaAICc/weight/error``.
    Successful fits come first (ascending AICc); failed candidates follow with
    an ``error`` string and null metrics — a failure never aborts the scan.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if xv.size < 3:
        raise ValueError("need at least 3 points to scan models")
    n = int(xv.size)

    weights: NDArray[np.float64] | None = None
    if dy is not None:
        weights = weights_from_dy(dy, n)

    names = list(models) if models is not None else default_candidates(n)
    entries: list[dict[str, Any]] = []
    for name in names:

        def reg_runner(model_name: str = name) -> tuple[dict[str, Any], list[str]]:
            return _registry_runner(model_name, xv, yv, weights)

        entries.append(_run_candidate(name, "registry", reg_runner, n))
    for eq in equations or []:
        eq_name = str(eq.get("name", "") or eq.get("equation", ""))
        equation = str(eq.get("equation", ""))
        guesses = eq.get("guesses")

        def eq_runner(
            eq_str: str = equation, g: Sequence[float] | None = guesses
        ) -> tuple[dict[str, Any], list[str]]:
            return _equation_runner(eq_str, g, xv, yv, weights)

        entries.append(_run_candidate(eq_name, "equation", eq_runner, n))

    ok = [e for e in entries if e["error"] is None]
    failed = [e for e in entries if e["error"] is not None]
    _rank(ok)
    return {"n": n, "nCandidates": len(entries), "results": ok + failed}
