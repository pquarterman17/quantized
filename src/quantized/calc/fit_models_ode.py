"""Fit built-in rate-equation (ODE) models (GAP_AUDIT_9 G11).

Pure calc layer. The user picks one of a small fixed set of systems; nothing
the user types is evaluated. Each is integrated with
``scipy.integrate.solve_ivp`` (LSODA, rtol 1e-9, atol 1e-12) from ``t0 = min(x)``
and the observed state is compared with y:

* ``first_order`` -- ``dy/dt = -k y``; params ``k, y0``; observes y.
* ``sequential``  -- ``A -k1-> B -k2-> C``; params ``k1, k2, A0, B0, C0``;
  observes the species chosen by ``observe`` (A, B or C).
* ``logistic``    -- ``dy/dt = r y (1 - y/K)``; params ``r, K, y0``; observes y.

Rate constants and ``K`` are bounded below at 0. Any parameter may be held
fixed (``hold``); by default the sequential model holds ``B0 = C0 = 0`` (a
plain A -> B -> C experiment starts as pure A) and every other parameter is
fitted. ODE fits can have local minima (notably swapped ``k1``/``k2`` in the
sequential model when only B is observed): give ``p0`` when the automatic
start (rates ~ 1/span) is poor. Parameter errors are Gauss-Newton
``s^2 (J'J)^-1`` over the fitted (non-held) parameters. Provisional, owner
to confirm: the model set, default holds, the automatic start and integrator
tolerances. Test oracles are the closed-form solutions.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares

from quantized.calc.fit_robust import clean_xy

__all__ = ["ODE_MODELS", "ode_fit", "ode_model_curve"]

F64 = NDArray[np.float64]
_INF = math.inf

ODE_MODELS: dict[str, dict[str, Any]] = {
    "first_order": {
        "label": "First-order decay",
        "params": ["k", "y0"],
        "lower": [0.0, -_INF],
        "upper": [_INF, _INF],
        "hold": {},
    },
    "sequential": {
        "label": "Sequential A to B to C",
        "params": ["k1", "k2", "A0", "B0", "C0"],
        "lower": [0.0, 0.0, -_INF, -_INF, -_INF],
        "upper": [_INF] * 5,
        "hold": {"B0": 0.0, "C0": 0.0},
    },
    "logistic": {
        "label": "Logistic growth",
        "params": ["r", "K", "y0"],
        "lower": [-_INF, 0.0, -_INF],
        "upper": [_INF] * 3,
        "hold": {},
    },
}
OBSERVABLES = {"sequential": ("A", "B", "C")}


def _rhs(model: str, p: F64) -> Any:
    if model == "first_order":
        return lambda t, s: [-p[0] * s[0]]
    if model == "sequential":
        k1, k2 = p[0], p[1]
        return lambda t, s: [-k1 * s[0], k1 * s[0] - k2 * s[1], k2 * s[1]]
    r, big_k = p[0], p[1]
    return lambda t, s: [r * s[0] * (1.0 - s[0] / big_k)]


def ode_model_curve(model: str, t: ArrayLike, p: ArrayLike, observe: str | None = None) -> F64:
    """Observed state of ``model`` at times ``t`` (any order) for parameters ``p``."""
    if model not in ODE_MODELS:
        raise ValueError(f"unknown ODE model {model!r}; choose from {sorted(ODE_MODELS)}")
    tv = np.asarray(t, dtype=float).ravel()
    pv = np.asarray(p, dtype=float).ravel()
    if pv.size != len(ODE_MODELS[model]["params"]):
        raise ValueError(f"{model} takes {len(ODE_MODELS[model]['params'])} parameters")
    idx = 0
    if model == "sequential":
        obs = observe or "A"
        if obs not in OBSERVABLES["sequential"]:
            raise ValueError("observe must be one of A, B, C")
        idx = "ABC".index(obs)
    elif observe not in (None, "y"):
        raise ValueError(f"{model} has a single observable; do not set observe")
    if model == "logistic" and pv[1] <= 0:
        raise ValueError("logistic K must be positive")
    y0 = (
        [pv[0 + 1]]
        if model == "first_order"
        else (list(pv[2:5]) if model == "sequential" else [pv[2]])
    )
    ut, inv = np.unique(tv, return_inverse=True)
    t0 = float(ut[0])
    if ut.size == 1:
        return np.full(tv.shape, y0[idx], dtype=float)
    sol = solve_ivp(
        _rhs(model, pv), (t0, float(ut[-1])), y0, t_eval=ut, method="LSODA", rtol=1e-9, atol=1e-12
    )
    if not sol.success or sol.y.shape[1] != ut.size:
        raise ValueError(f"ODE integration failed: {sol.message}")
    return np.asarray(sol.y[idx][inv], dtype=float)


def _auto_start(model: str, x: F64, y: F64) -> F64:
    span = float(x.max() - x.min()) or 1.0
    y0 = float(y[np.argmin(x)])
    if model == "first_order":
        return np.array([1.0 / (span / 3.0), y0])
    if model == "sequential":
        return np.array(
            [3.0 / span, 1.0 / span, y0 if y0 != 0 else float(np.max(np.abs(y))), 0.0, 0.0]
        )
    return np.array(
        [
            4.0 / span,
            float(np.max(y)) * 1.1 or 1.0,
            y0 if y0 > 0 else float(np.max(y)) * 0.05 or 0.1,
        ]
    )


def ode_fit(
    x: ArrayLike,
    y: ArrayLike,
    model: str,
    *,
    observe: str | None = None,
    p0: Sequence[float] | None = None,
    hold: Mapping[str, float] | None = None,
    weights: ArrayLike | None = None,
) -> dict[str, Any]:
    """Fit ``model`` to (x, y). ``hold`` maps parameter name -> fixed value;
    ``None`` uses the model's default holds, ``{}`` fits everything."""
    if model not in ODE_MODELS:
        raise ValueError(f"unknown ODE model {model!r}; choose from {sorted(ODE_MODELS)}")
    xv, yv = clean_xy(x, y)
    spec = ODE_MODELS[model]
    names: list[str] = spec["params"]
    held = dict(spec["hold"] if hold is None else hold)
    bad = [k for k in held if k not in names]
    if bad:
        raise ValueError(f"cannot hold unknown parameter(s): {bad}")
    if any(not math.isfinite(v) for v in held.values()):
        raise ValueError("held values must be finite")
    start = _auto_start(model, xv, yv) if p0 is None else np.asarray(p0, dtype=float)
    if start.size != len(names):
        raise ValueError(f"p0 needs {len(names)} values ({', '.join(names)})")
    for i, nm in enumerate(names):
        if nm in held:
            start[i] = held[nm]
    free = [i for i, nm in enumerate(names) if nm not in held]
    if not free:
        raise ValueError("every parameter is held; nothing to fit")
    if xv.size <= len(free):
        raise ValueError(
            f"need more points than fitted parameters (n={xv.size}, fitted={len(free)})"
        )
    w = np.ones(xv.size) if weights is None else np.asarray(weights, dtype=float).ravel()
    if w.size != xv.size or not np.all(np.isfinite(w)) or np.any(w < 0) or not np.any(w > 0):
        raise ValueError("weights must have one finite entry >= 0 per point, not all zero")
    sw = np.sqrt(w)
    lb = np.asarray(spec["lower"], dtype=float)[free]
    ub = np.asarray(spec["upper"], dtype=float)[free]
    z0 = np.clip(start[free], np.where(np.isfinite(lb), lb + 1e-10, lb), ub)

    def full(z: F64) -> F64:
        p = start.copy()
        p[free] = z
        return p

    def resid(z: F64) -> F64:
        return np.asarray(sw * (ode_model_curve(model, xv, full(z), observe) - yv), dtype=float)

    sol = least_squares(resid, z0, bounds=(lb, ub), method="trf", x_scale="jac")
    p = full(np.asarray(sol.x, dtype=float))
    y_fit = ode_model_curve(model, xv, p, observe)
    rss = float(np.sum(w * (yv - y_fit) ** 2))
    s2 = rss / max(xv.size - len(free), 1)
    err_free: F64 = np.full(len(free), np.nan)
    try:
        err_free = np.asarray(
            np.sqrt(np.abs(np.diag(np.linalg.inv(sol.jac.T @ sol.jac))) * s2), dtype=float
        )
    except np.linalg.LinAlgError:
        pass
    errs = np.zeros(len(names))
    errs[free] = err_free
    tot = float(np.sum((yv - yv.mean()) ** 2))
    return {
        "model": model,
        "observe": observe,
        "paramNames": names,
        "params": p,
        "errors": errs,
        "held": [nm for nm in names if nm in held],
        "yFit": y_fit,
        "residuals": yv - y_fit,
        "rss": rss,
        "rSquared": 1.0 - float(np.sum((yv - y_fit) ** 2)) / tot if tot > 0 else math.nan,
        "nPoints": int(xv.size),
        "success": bool(sol.success),
        "message": str(sol.message),
    }
