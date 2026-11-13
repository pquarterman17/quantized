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

Default candidates: the MATLAB-parity registry (plus any plugin models) and a
small, fast subset of the Origin built-in library (``DEFAULT_SCAN_ORIGIN_MODELS``).
The rest of the Origin library (``ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN``) is fitted
only when named explicitly — scanning all of it made a default scan ~10x
slower (53 s vs 5.6 s on 2000 points) for candidates that mostly duplicate a
model already in the set. In a default scan the Origin models also run under
an iteration budget (``ORIGIN_SCAN_MAX_ITER_PER_PARAM``); one that has not
converged within it is reported as ``skipped: too slow`` rather than ranked
on an unfinished fit. Explicitly requested models are never capped.

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

__all__ = [
    "DEFAULT_SCAN_ORIGIN_MODELS",
    "ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN",
    "ORIGIN_SCAN_MAX_ITER_PER_PARAM",
    "aicc_from_aic",
    "default_candidates",
    "scan_models",
]

# Origin built-ins that join the default scan: one cheap representative per
# shape family that the MATLAB-parity set does not already cover the same way
# (peaks WITH a y0 baseline, a true Voigt, a two-asymptote step, a sine, a
# line through the origin). Each has <= 5 parameters and a variable-projection
# guess that lands in the right basin, so a matching model converges in
# ~50 Nelder-Mead iterations per parameter. ("Proportional" lives in the same
# library modules but is a quantized addition, not an Origin function.)
DEFAULT_SCAN_ORIGIN_MODELS: tuple[str, ...] = (
    "Gauss", "Lorentz", "Voigt", "ExpDec1", "Boltzmann", "Hill", "SGompertz", "Sine",
    "Proportional",
)

# Origin built-ins left OUT of the default scan (still fitted when listed in
# ``models``). Every Origin-library model must appear in exactly one of these
# two tuples — tests/test_calc_fit_scan.py enforces the partition, so adding
# a model forces the decision.
ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN: tuple[str, ...] = (
    # High-order polynomials: 6-10 free parameters under Nelder-Mead take
    # seconds each, and they fit almost anything (AICc cannot rescue that).
    "Poly5", "Poly 6", "Poly 7", "Poly 8", "Poly",
    # Multi-exponentials and the x0 variants: slow to converge on data that
    # is not multi-exponential; the x0 variants are degenerate unless x0 is held.
    "ExpDec2", "ExpDec3", "ExpDecay1", "ExpDecay2", "ExpDecay3",
    "ExpGro2", "ExpGrow1", "ExpGrow2",
    # Same curve as a model already scanned, in another parameterization.
    "ExpGro1", "GaussAmp", "PsdVoigt1", "PsdVoigt2", "Allometric1", "MichaelisMenten", "DoseResp",
    "Hill1", "Logistic (Origin)", "SLogistic1",
    # 5-6 parameter shapes that are slow off-model.
    "LogNormal", "Asym2Sig", "Logistic5", "SWeibull1", "SineDamp",
)

# Default-scan iteration budget for the Origin models, per free parameter
# (curve_fit's own default is 5000 per parameter). On-model fits need ~50 per
# parameter (measured); an off-model fit that is still creeping at 400 is not
# going to win the ranking, so it is cut and reported instead of timed out.
# An iteration count, not a wall clock: the outcome is the same on a loaded
# machine.
ORIGIN_SCAN_MAX_ITER_PER_PARAM = 400


class _TooSlowError(RuntimeError):
    """A capped default-scan fit did not converge within its iteration budget."""

# One candidate's fit runner: () -> (curve_fit result, param names).
_Runner = Callable[[], tuple[dict[str, Any], list[str]]]

# Mirrors calc.fit_bumps' job-runner bridge shape (fraction, message) -> None /
# () -> bool, so routes/fitting.py's job-queued /scan/job can pass job.report /
# job.aborted straight through without an adapter. Kept local (not imported
# from quantized.jobs) so calc/ stays free of any dependency on the job store.
ProgressFn = Callable[[float, str], None]
AbortFn = Callable[[], bool]


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

    The Origin built-ins in ``ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN`` are left out
    (see the module docstring); they can still be scanned by name.
    """
    skip = frozenset(ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN)
    return [
        name for name, spec in FIT_MODELS.items()
        if name not in skip and spec["nParams"] < n_points / 3
    ]


def _registry_runner(
    name: str,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    weights: NDArray[np.float64] | None,
    max_iter_per_param: int | None = None,
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
    max_iter = None if max_iter_per_param is None else max_iter_per_param * int(spec["nParams"])
    result = curve_fit(
        xv, yv, model_fcn, p0, lower=spec["lb"], upper=spec["ub"], weights=weights,
        max_iter=max_iter,
    )
    if max_iter is not None and int(result["exitFlag"]) != 1:
        raise _TooSlowError(
            f"skipped: too slow (no convergence within {max_iter} iterations in a default "
            "scan; select the model explicitly to fit it fully)"
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
    progress_callback: ProgressFn | None = None,
    abort_check: AbortFn | None = None,
) -> dict[str, Any]:
    """Fit every candidate model to (x, y) and rank by AICc (ascending).

    ``models`` — registry model names; ``None`` selects the default set
    (``default_candidates``: registry models with ``nParams < n/3``, minus
    ``ORIGIN_MODELS_NOT_IN_DEFAULT_SCAN``). Only in that default set, the
    Origin built-ins run under ``ORIGIN_SCAN_MAX_ITER_PER_PARAM`` and come
    back as a ``skipped: too slow`` error entry if they have not converged;
    models named explicitly are always fitted in full.
    ``equations`` — custom-equation candidates ``{"name", "equation",
    "guesses"?}`` (the saved custom fit models); guesses default to 1.0 each.
    ``dy`` — optional per-point 1-sigma errors -> weights ``1/dy**2``.

    ``progress_callback(fraction, message)`` fires once BEFORE each candidate
    runs (fraction = candidates completed so far / total, message names the
    candidate — e.g. ``"Scanning 4/29: Voigt"``), the same (fraction, message)
    shape as ``Job.report`` so a job route can pass it straight through with
    no adapter. ``abort_check()`` is polled at the same point, between
    candidates: a ``True`` stops the scan before the NEXT candidate starts
    (the current entries list is dropped, not returned — the job runner
    (``quantized.jobs.JobStore``) marks the whole job ``cancelled`` once its
    abort flag is set, matching the DREAM job's cancel contract in
    ``calc.fit_bumps``/``routes/fitting_bumps.py``: no partial scan result).
    A ``progress_callback`` that itself raises (e.g. ``Job.report`` after a
    cancel request) propagates out of ``scan_models`` unchanged — the same
    cooperative-cancel path ``fit_bumps`` relies on.

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
    capped = frozenset(DEFAULT_SCAN_ORIGIN_MODELS) if models is None else frozenset()
    eq_list = list(equations or [])
    total = len(names) + len(eq_list)

    entries: list[dict[str, Any]] = []
    done = 0
    aborted = False
    for name in names:
        if abort_check is not None and abort_check():
            aborted = True
            break
        if progress_callback is not None:
            progress_callback(done / total, f"Scanning {done + 1}/{total}: {name}")

        cap = ORIGIN_SCAN_MAX_ITER_PER_PARAM if name in capped else None

        def reg_runner(
            model_name: str = name, iter_cap: int | None = cap
        ) -> tuple[dict[str, Any], list[str]]:
            return _registry_runner(model_name, xv, yv, weights, iter_cap)

        entries.append(_run_candidate(name, "registry", reg_runner, n))
        done += 1

    if not aborted:
        for eq in eq_list:
            if abort_check is not None and abort_check():
                break
            eq_name = str(eq.get("name", "") or eq.get("equation", ""))
            if progress_callback is not None:
                progress_callback(done / total, f"Scanning {done + 1}/{total}: {eq_name}")
            equation = str(eq.get("equation", ""))
            guesses = eq.get("guesses")

            def eq_runner(
                eq_str: str = equation, g: Sequence[float] | None = guesses
            ) -> tuple[dict[str, Any], list[str]]:
                return _equation_runner(eq_str, g, xv, yv, weights)

            entries.append(_run_candidate(eq_name, "equation", eq_runner, n))
            done += 1

    ok = [e for e in entries if e["error"] is None]
    failed = [e for e in entries if e["error"] is not None]
    _rank(ok)
    return {"n": n, "nCandidates": len(entries), "results": ok + failed}
