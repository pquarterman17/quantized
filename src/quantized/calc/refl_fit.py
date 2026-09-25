r"""Fit a specular-reflectivity layer model to measured data (audit P2.2).

Pure calc layer. Builds on :func:`quantized.calc.reflectivity.parratt_refl`
(golden vs MATLAB ``parrattRefl``); MATLAB has no reflectivity *fitter*, so
this module is new capability, verified by recovering the known truth of
synthetic data and by invariants, never by golden parity.

Model and conventions live in :mod:`quantized.calc.refl_model`: named
parameters ``L{i}.{thickness|sld|isld|roughness|msld}`` plus scale/background
(per-channel names allowed), each with ``value``, ``vary``, ``min``/``max`` and
an optional ``tie``; one channel per measured curve with a spin of none, ``+``
or ``-`` so a PNR ++/-- pair is fitted jointly. Free parameters are fitted in
bound-normalised space ``x = (p - min)/(max - min)`` because SLDs (~1e-6) and
thicknesses (~1e2) differ by eight decades.

Objective
---------
``weighting="dr"`` minimises chi2 = sum(((R_model - R)/dR)^2) and needs
finite positive dR. ``"log"`` minimises the sum of squared log10 residuals,
the usual choice for XRR data with no error column; that sum is NOT a
chi-square, so it is reported as ``sum_sq_log`` and ``chi2`` is None, and the
errors it yields assume equal scatter in log R.

Optimiser and uncertainty
-------------------------
scipy's bounded trust-region-reflective ``least_squares`` — a LOCAL method: a
fit started far from the truth can settle in a neighbouring fringe minimum,
so starting values matter. ``max_nfev`` bounds TRF's function evaluations;
each Jacobian costs ``n_free`` more, and ``n_evaluations`` reports the true
model-evaluation count. ``deadline_s`` stops the fit at a wall-clock budget
and returns the best point seen (``success`` False, with a warning).

Standard errors come from the Jacobian covariance scaled by the reduced
objective (lmfit's convention; refl1d does not scale — scaling shrinks errors
when the fit is better than dR predicts). A parameter on a bound, or one the
data do not determine (a zero or degenerate Jacobian direction, which a
pseudo-inverse would silently report as error 0), gets ``stderr`` None and a
warning. A tied parameter reports its target's error.
"""

from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares

from quantized.calc.refl_model import (
    ReflChannel,
    ReflParams,
    layer_stack,
    validate_model,
)
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import sld_profile

__all__ = ["channel_model", "channel_residuals", "fit_reflectivity", "model_curves"]

_WEIGHTINGS = ("dr", "log")
_TINY = 1e-300
# Singular value / largest below which a direction counts as undetermined.
# Measured 2026-09-24: an exactly degenerate pair (two same-SLD layers) sits at
# 3.6e-9 (finite-difference noise), the weakest direction of a healthy 9-param
# bilayer fit at 8.8e-3; 1e-6 leaves ~3 decades of margin on both sides.
_DEGENERATE = 1e-6


class _Deadline(Exception):
    pass


def channel_model(ch: ReflChannel, params: ReflParams, v: NDArray[np.float64], n_layers: int,
           m: NDArray[np.bool_]) -> NDArray[np.float64]:
    res: Any = ch.dq[m] if ch.dq is not None else ch.resolution
    return parratt_refl(
        ch.q_all[m],
        layer_stack(params, v, n_layers, ch.spin),
        scale=params.get(v, ch.scale_name, 1.0),
        background=params.get(v, ch.background_name, 0.0),
        resolution=res,
    )


def channel_residuals(ch: ReflChannel, model: NDArray[np.float64], m: NDArray[np.bool_],
           weighting: str) -> NDArray[np.float64]:
    if weighting == "dr":
        assert ch.dr is not None
        return np.asarray((model - ch.r_all[m]) / ch.dr[m], dtype=float)
    return np.asarray(np.log10(np.maximum(model, _TINY)) - np.log10(ch.r_all[m]), dtype=float)


def fit_reflectivity(
    parameters: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    *,
    weighting: str = "dr",
    max_nfev: int = 200,
    deadline_s: float | None = None,
    sld_points: int = 400,
) -> dict[str, Any]:
    """Fit a layer model to one or more reflectivity curves.

    Returns ``parameters`` (value, stderr or None, vary, tie, at_bound),
    the objective (``chi2``/``reduced_chi2`` for dr weighting,
    ``sum_sq_log``/``reduced_sum_sq_log`` for log), ``n_points``/``n_free``,
    ``success``/``message``/``n_evaluations``, per-channel ``curves`` (q, r,
    dr, model, residual on the fitted points), ``sld_profiles`` (one per spin
    state present), ``correlation`` among free parameters, and ``warnings``.
    """
    if weighting not in _WEIGHTINGS:
        raise ValueError(f"weighting must be one of {_WEIGHTINGS}")
    if not channels:
        raise ValueError("need at least one data channel")
    n_layers = validate_model(parameters, channels)
    params = ReflParams(parameters)
    chans = [ReflChannel(c, i) for i, c in enumerate(channels)]
    masks = [c.points(weighting) for c in chans]
    n_points = int(sum(int(m.sum()) for m in masks))
    n_free = len(params.free)
    if n_points <= n_free:
        raise ValueError(f"{n_points} usable points cannot constrain {n_free} free parameters")

    t_end = None if deadline_s is None else time.monotonic() + deadline_s
    count = {"n": 0}
    best: dict[str, Any] = {"cost": math.inf, "x": params.x0()}

    def residuals(x: NDArray[np.float64]) -> NDArray[np.float64]:
        if t_end is not None and time.monotonic() > t_end:
            raise _Deadline
        count["n"] += 1
        v = params.full(x)
        r = np.concatenate([
            channel_residuals(c, channel_model(c, params, v, n_layers, m), m, weighting)
            for c, m in zip(chans, masks, strict=True)
        ])
        cost = float(np.sum(r**2))
        if cost < best["cost"]:
            best["cost"], best["x"] = cost, np.array(x, dtype=float)
        return r

    warnings: list[str] = []
    x0 = params.x0()
    jac: NDArray[np.float64] | None = None
    if n_free:
        try:
            sol = least_squares(residuals, x0, bounds=(0.0, 1.0), method="trf",
                                x_scale="jac", max_nfev=max_nfev)
            x, success, message, jac = sol.x, bool(sol.success), str(sol.message), sol.jac
            if not success or sol.status == 0:
                success = False
                warnings.append(f"the optimiser stopped without converging: {message}")
        except _Deadline:
            x, success = best["x"], False
            message = f"stopped at the {deadline_s:g} s time limit"
            warnings.append(f"the fit {message}; the best point found is reported")
    else:
        x, success, message = x0, True, "no free parameters"
    t_end = None
    resid = residuals(x)
    obj = float(np.sum(resid**2))
    red = obj / (n_points - n_free)

    v = params.full(x)
    n_all = len(params.names)
    errs = np.full(n_all, np.nan)
    at_bound = np.zeros(n_all, dtype=bool)
    undetermined = np.zeros(n_all, dtype=bool)
    corr: list[list[float | None]] = []
    if n_free and jac is not None:
        for k, i in enumerate(params.free):
            at_bound[i] = x[k] < 1e-6 or x[k] > 1 - 1e-6
        _, s, vt = np.linalg.svd(jac, full_matrices=False)
        smax = float(s[0]) if s.size else 0.0
        weak = s <= _DEGENERATE * smax if smax > 0 else np.ones_like(s, dtype=bool)
        for row in vt[weak]:
            for kk in np.nonzero(np.abs(row) > 1e-3)[0]:
                undetermined[params.free[int(kk)]] = True
        inv_s2 = np.zeros_like(s)
        inv_s2[~weak] = 1.0 / s[~weak] ** 2
        cov = (vt.T * inv_s2) @ vt * red * np.outer(params.span, params.span)
        sd = np.sqrt(np.clip(np.diag(cov), 0.0, None))
        for k, i in enumerate(params.free):
            errs[i] = sd[k]
        with np.errstate(invalid="ignore", divide="ignore"):
            c = cov / np.outer(sd, sd)
        corr = [[_finite(val) for val in r] for r in c]
        if np.any(at_bound):
            names = [params.names[i] for i in params.free if at_bound[i]]
            warnings.append(
                "parameters ended on a bound (errors not reported): " + ", ".join(names)
            )
        if np.any(undetermined):
            names = [params.names[i] for i in params.free if undetermined[i]]
            warnings.append(
                "the data do not determine these parameters independently (no error "
                "reported; fix or tie some of them): " + ", ".join(names)
            )

    def stderr(i: int) -> float | None:
        j = params.root[i]
        if j not in params.free or at_bound[j] or undetermined[j]:
            return None
        return _finite(errs[j])

    out_params = [{
        "name": n,
        "value": float(v[i]),
        "stderr": stderr(i),
        "vary": i in params.free,
        "tie": params.tie[i],
        "at_bound": bool(at_bound[i]),
    } for i, n in enumerate(params.names)]

    curves = []
    for c, m in zip(chans, masks, strict=True):
        model = channel_model(c, params, v, n_layers, m)
        curves.append({
            "label": c.label,
            "spin": c.spin_label,
            "q": c.q_all[m].tolist(),
            "r": c.r_all[m].tolist(),
            "dr": None if c.dr is None else c.dr[m].tolist(),
            "model": model.tolist(),
            "residual": channel_residuals(c, model, m, weighting).tolist(),
        })

    profiles = []
    for spin in sorted({c.spin for c in chans}):
        z, sld = sld_profile(layer_stack(params, v, n_layers, spin), n_points=sld_points)
        profiles.append({"spin": {0: None, 1: "+", -1: "-"}[spin],
                         "z": np.asarray(z).tolist(), "sld": np.asarray(sld).tolist()})

    is_chi = weighting == "dr"
    return {
        "parameters": out_params,
        "free": [params.names[i] for i in params.free],
        "correlation": corr,
        "chi2": obj if is_chi else None,
        "reduced_chi2": red if is_chi else None,
        "sum_sq_log": None if is_chi else obj,
        "reduced_sum_sq_log": None if is_chi else red,
        "n_points": n_points,
        "n_free": n_free,
        "success": success,
        "message": message,
        "n_evaluations": count["n"],
        "weighting": weighting,
        "curves": curves,
        "sld_profiles": profiles,
        "warnings": warnings,
    }


def model_curves(
    parameters: list[dict[str, Any]], q: list[float], spins: list[str | None],
    *, resolution: float | None = None,
) -> list[NDArray[np.float64]]:
    """Evaluate the model (no fitting) on a Q grid for each spin state."""
    fixed = [{**p, "vary": False} for p in parameters]
    qa = np.asarray(q, dtype=float)
    chans = [{"q": qa, "r": np.ones_like(qa), "spin": s, "resolution": resolution} for s in spins]
    n_layers = validate_model(fixed, chans)
    params = ReflParams(fixed)
    v = params.full(np.zeros(0))
    out = []
    for i, spec in enumerate(chans):
        ch = ReflChannel(spec, i)
        out.append(channel_model(ch, params, v, n_layers, np.ones(qa.size, dtype=bool)))
    return out


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(float(x)) else None
