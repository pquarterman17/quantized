"""Standard (calibration) curve: fit known standards, then read unknowns off it.

Pure calc layer. The guided workflow of an assay: the user has standards of
known concentration ``x`` with a measured response ``y`` (absorbance, peak
area, ...), and unknown samples with a measured response only. The curve is
fitted to the standards (``y = f(x; theta)``, unweighted least squares through
``scipy.optimize.curve_fit``) and every unknown response ``y0`` is inverted to
a concentration ``x0`` with a confidence interval -- the "inverse prediction"
of calibration (Draper & Smith, *Applied Regression Analysis*, 3rd ed., 1998,
sec. 3.2; Miller & Miller, *Statistics and Chemometrics for Analytical
Chemistry*, ch. 5).

Models (``STANDARD_MODELS``): ``linear`` ``y = a + b x``, ``quadratic``
``y = a + b x + c x^2`` and ``4pl`` (the four-parameter logistic of ELISA,
``y = D + (A - D) / (1 + (x / C)^B)``, A the response at zero, D at infinity,
C the mid-point, B the slope; needs ``x >= 0``).

Inverse prediction. ``x0`` solves ``f(x0; theta) = y0`` (closed form for the
linear and 4PL models, the real roots of the polynomial for the quadratic).
Its standard error is the delta method on the implicit function: with ``g_j =
-(df/dtheta_j) / (df/dx)`` and ``dx/dy = 1 / (df/dx)`` taken at ``x0``,

    var(x0) = (dx/dy)^2 * s^2 / m  +  g' Sigma g

where ``s^2`` is the fit's residual variance (``dof = n - p``), ``Sigma`` the
parameter covariance and ``m`` the number of replicate readings averaged into
``y0``. For the straight line this is exactly the classical formula

    se(x0) = s / |b| * sqrt(1/m + 1/n + (y0 - ybar)^2 / (b^2 Sxx)),

which the tests pin by hand. The interval is ``x0 +/- t(1 - alpha/2, dof) *
se``. It is a first-order interval: for a line whose slope is not clearly
nonzero (``t^2 s^2 / (b^2 Sxx) >= 0.1``, Draper & Smith's rule) the exact
(Fieller) interval is unbounded, so none is given.

Fail closed. A response outside the curve (a 4PL ``y0`` not strictly between
``A`` and ``D``, a quadratic with no real root) gives ``x = None`` and the
reason. A root outside the range of the standards is returned but marked
``extrapolated``. A quadratic with two roots inside the range is ``ambiguous``.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import curve_fit
from scipy.stats import t as student_t

__all__ = ["STANDARD_MODELS", "standard_curve"]

_Arr = NDArray[np.float64]
#: A line is trusted for an interval below this value of Draper & Smith's ``g``.
_G_MAX = 0.1


@dataclass(frozen=True)
class _Model:
    n_params: int
    param_names: tuple[str, ...]
    f: Callable[[_Arr, _Arr], _Arr]
    dfdx: Callable[[float, _Arr], float]
    dfdtheta: Callable[[float, _Arr], _Arr]
    p0: Callable[[_Arr, _Arr], list[float]]
    bounds: Callable[[_Arr, _Arr], tuple[list[float], list[float]]]
    roots: Callable[[float, _Arr], list[float]]


def _poly(deg: int) -> Callable[[_Arr, _Arr], _Arr]:
    def f(x: _Arr, p: _Arr) -> _Arr:
        return np.asarray(sum(p[j] * x**j for j in range(deg + 1)), dtype=float)

    return f


def _lin_roots(y: float, p: _Arr) -> list[float]:
    return [] if p[1] == 0 else [(y - p[0]) / p[1]]


def _quad_roots(y: float, p: _Arr) -> list[float]:
    a, b, c = p
    if c == 0:
        return _lin_roots(y, p)
    disc = b * b - 4.0 * c * (a - y)
    if disc < 0:
        return []
    root = math.sqrt(disc)
    return sorted([(-b - root) / (2.0 * c), (-b + root) / (2.0 * c)])


def _u(x: float, p: _Arr) -> tuple[float, float]:
    t = (x / p[2]) ** p[1]
    return 1.0 / (1.0 + t), t


def _fpl(x: _Arr, p: _Arr) -> _Arr:
    a, b, c, d = p
    return np.asarray(d + (a - d) / (1.0 + (x / c) ** b), dtype=float)


def _fpl_dfdx(x: float, p: _Arr) -> float:
    u, t = _u(x, p)
    return float(-(p[0] - p[3]) * u * u * t * p[1] / x)


def _fpl_dfdtheta(x: float, p: _Arr) -> _Arr:
    u, t = _u(x, p)
    span = p[0] - p[3]
    du = span * u * u * t
    return np.array([u, -du * math.log(x / p[2]), du * p[1] / p[2], 1.0 - u])


def _fpl_roots(y: float, p: _Arr) -> list[float]:
    a, b, c, d = p
    if (y - d) == 0 or not min(a, d) < y < max(a, d):
        return []
    r = (a - d) / (y - d) - 1.0
    return [] if r <= 0 else [float(c * r ** (1.0 / b))]


def _fpl_p0(x: _Arr, y: _Arr) -> list[float]:
    order = np.argsort(x)
    lo, hi = float(y[order[0]]), float(y[order[-1]])
    positive = x[x > 0]
    mid = float(np.median(positive)) if positive.size else 1.0
    return [lo, 1.0, mid, hi]


def _fpl_bounds(x: _Arr, y: _Arr) -> tuple[list[float], list[float]]:
    span = float(np.ptp(y)) or 1.0
    ylo, yhi = float(y.min()) - span, float(y.max()) + span
    xmax = float(x.max()) if x.max() > 0 else 1.0
    return [ylo, 0.05, xmax * 1e-6, ylo], [yhi, 20.0, xmax * 1e6, yhi]


def _poly_p0(deg: int) -> Callable[[_Arr, _Arr], list[float]]:
    def p0(x: _Arr, y: _Arr) -> list[float]:
        return [float(v) for v in np.polynomial.polynomial.polyfit(x, y, deg)]

    return p0


def _free(n: int) -> Callable[[_Arr, _Arr], tuple[list[float], list[float]]]:
    return lambda x, y: ([-np.inf] * n, [np.inf] * n)


STANDARD_MODELS: dict[str, _Model] = {
    "linear": _Model(
        2, ("a", "b"), _poly(1), lambda x, p: float(p[1]),
        lambda x, p: np.array([1.0, x]), _poly_p0(1), _free(2), _lin_roots,
    ),
    "quadratic": _Model(
        3, ("a", "b", "c"), _poly(2), lambda x, p: float(p[1] + 2.0 * p[2] * x),
        lambda x, p: np.array([1.0, x, x * x]), _poly_p0(2), _free(3), _quad_roots,
    ),
    "4pl": _Model(
        4, ("A", "B", "C", "D"), _fpl, _fpl_dfdx, _fpl_dfdtheta, _fpl_p0, _fpl_bounds, _fpl_roots,
    ),
}


def _fit(model: _Model, name: str, x: _Arr, y: _Arr) -> tuple[_Arr, _Arr, float, int]:
    n, k = x.size, model.n_params
    if n <= k:
        raise ValueError(f"the {name} curve has {k} parameters and needs more than {k} standards")
    if name == "4pl" and np.any(x < 0):
        raise ValueError("the 4pl curve needs standards with x >= 0")
    if np.unique(x).size < k:
        raise ValueError(f"the {name} curve needs at least {k} distinct standard x values")
    lo, hi = model.bounds(x, y)
    try:
        popt, pcov = curve_fit(
            lambda xx, *pp: model.f(xx, np.asarray(pp, dtype=float)),
            x, y, p0=model.p0(x, y), bounds=(lo, hi), maxfev=20000,
        )
    except (RuntimeError, ValueError) as exc:
        raise ValueError(f"the {name} curve did not fit the standards: {exc}") from exc
    res = y - model.f(x, popt)
    dof = n - k
    return np.asarray(popt, float), np.asarray(pcov, float), float(res @ res / dof), dof


def _line_is_weak(p: _Arr, s2: float, dof: int, x: _Arr, tq: float) -> bool:
    sxx = float(((x - x.mean()) ** 2).sum())
    return bool(tq * tq * s2 / (p[1] ** 2 * sxx) >= _G_MAX)


def _unknown(
    model: _Model, name: str, y0: float, popt: _Arr, pcov: _Arr, s2: float, dof: int,
    x: _Arr, m: int, tq: float,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "y": y0, "x": None, "se": None, "lower": None, "upper": None,
        "status": "ok", "reason": None,
    }
    roots = model.roots(y0, popt)
    if not roots:
        out["status"], out["reason"] = "outside curve", "the response is not on the fitted curve"
        return out
    xlo, xhi = float(x.min()), float(x.max())
    inside = [r for r in roots if xlo <= r <= xhi]
    if len(inside) > 1:
        out["status"], out["reason"] = "ambiguous", "two concentrations in range give this response"
        return out
    x0 = inside[0] if inside else min(roots, key=lambda r: min(abs(r - xlo), abs(r - xhi)))
    if not inside:
        out["status"], out["reason"] = "extrapolated", "outside the range of the standards"
    out["x"] = float(x0)
    slope = model.dfdx(x0, popt)
    if slope == 0 or not math.isfinite(slope):
        out["reason"] = out["reason"] or "flat curve at this response"
        out["status"] = "outside curve" if slope == 0 else out["status"]
        out["x"] = None
        return out
    if name == "linear" and _line_is_weak(popt, s2, dof, x, tq):
        out["reason"] = "slope not distinguishable from zero: no interval"
        return out
    g = -model.dfdtheta(x0, popt) / slope
    var = (1.0 / slope) ** 2 * s2 / m + float(g @ pcov @ g)
    if not math.isfinite(var) or var < 0:
        return out
    se = math.sqrt(var)
    out.update(se=se, lower=x0 - tq * se, upper=x0 + tq * se)
    return out


def standard_curve(
    x: ArrayLike,
    y: ArrayLike,
    unknowns: Sequence[float],
    *,
    model: str = "linear",
    confidence: float = 0.95,
    replicates: int = 1,
) -> dict[str, Any]:
    """Fit ``model`` to the standards ``(x, y)`` and invert each response in ``unknowns``.

    ``replicates`` is the number of readings averaged into each unknown response
    (``m`` in the module doc). Returns ``{model, paramNames, params, paramSE,
    n, dof, residualSE, r2, xRange, tCrit, confidence, unknowns}``; each unknown has
    ``y, x, se, lower, upper, status, reason``. ``ValueError`` for input that
    cannot be fitted (too few or non-finite standards, a bad model name)."""
    spec = STANDARD_MODELS.get(model)
    if spec is None:
        known = ", ".join(STANDARD_MODELS)
        raise ValueError(f"unknown standard-curve model {model!r}; use {known}")
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence must be between 0 and 1")
    if replicates < 1:
        raise ValueError("replicates must be at least 1")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if not (np.isfinite(xv).all() and np.isfinite(yv).all()):
        raise ValueError("the standards must be finite numbers")
    if not all(math.isfinite(float(v)) for v in unknowns):
        raise ValueError("the unknown responses must be finite numbers")
    popt, pcov, s2, dof = _fit(spec, model, xv, yv)
    tq = float(student_t.ppf(1.0 - (1.0 - confidence) / 2.0, dof))
    sst = float(((yv - yv.mean()) ** 2).sum())
    sse = s2 * dof
    return {
        "model": model,
        "paramNames": list(spec.param_names),
        "params": [float(v) for v in popt],
        "paramSE": [float(v) for v in np.sqrt(np.diag(pcov))],
        "n": int(xv.size),
        "dof": dof,
        "residualSE": math.sqrt(s2),
        "r2": 1.0 - sse / sst if sst > 0 else None,
        "xRange": [float(xv.min()), float(xv.max())],
        "tCrit": tq,
        "confidence": confidence,
        "unknowns": [
            _unknown(spec, model, float(v), popt, pcov, s2, dof, xv, replicates, tq)
            for v in unknowns
        ],
    }
