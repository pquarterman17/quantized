r"""Fit a mixed-shape peak model to (x, y) data (audit P2.4).

Pure calc layer. New capability beside the golden MATLAB-parity global fit
(:mod:`quantized.calc.peak_multifit`), so it is verified by recovering the
known truth of synthetic data and by invariants, never by golden parity. The
model, parameter naming and bounds live in :mod:`quantized.calc.peak_model`;
the optimiser and uncertainty design follow :mod:`quantized.calc.refl_fit`.

Objective
---------
Unweighted: minimise SSR = sum((y - f)^2). With ``y_err`` (every fitted point
finite and positive): minimise chi2 = sum(((y - f)/y_err)^2). ``chi2`` and
``reduced_chi2`` are reported ONLY for a weighted fit; ``ssr`` (always the
plain unweighted sum) is reported for both, so neither is ever mislabelled.

Optimiser and uncertainty
-------------------------
scipy's bounded trust-region-reflective ``least_squares`` - a LOCAL method, so
starting values matter. ``deadline_s`` stops the fit at a wall-clock budget
and returns the best point seen (``success`` False, a warning, no errors).

Covariance: ``C = (J^T J)^+ * s^2`` with ``s^2`` the reduced objective
(lmfit's ``scale_covar`` convention, as in refl_fit). The pseudo-inverse is
taken on the COLUMN-EQUILIBRATED Jacobian's SVD, so the degenerate-direction
test does not depend on parameter units: a singular value below
:data:`DEGENERATE_RATIO` times the largest marks every parameter with a
material share of that direction as undetermined (``stderr`` None + warning),
where a plain inverse would report a meaningless number. A parameter on a
bound also gets ``stderr`` None; a tied parameter reports its target's error.

Derived peak quantities (centre, FWHM, height, area; closed forms in
:func:`quantized.calc.peak_model.peak_area` / ``peak_fwhm``) carry delta-
method errors: ``var(g) = grad(g)^T C grad(g)``, the gradient taken over the
free parameters by central differences of the closed form (step 1e-6
relative; exact to rounding for the bilinear G/L/pV forms) and summed through
ties. It is None when any contributing parameter has no error.

Metrics: ``dof = n_points - n_free``; ``R^2 = 1 - SSR/SST`` (weighted fit:
``1 - chi2 / sum(w (y - ybar_w)^2)``, ``ybar_w`` the weighted mean);
adjusted ``R^2 = 1 - (1 - R^2)(n - 1)/dof`` (Origin's form); ``AIC = n ln(O/n)
+ 2k`` and ``BIC = n ln(O/n) + k ln n`` with ``O`` the minimised objective and
``k = n_free`` (lmfit's convention: only differences between models fitted to
the same points and weights mean anything).
"""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import least_squares

from quantized.calc.peak_model import PeakModel, PeakParams, peak_area, peak_fwhm

__all__ = ["DEGENERATE_RATIO", "OVERLAP_FWHM_FRACTION", "fit_peak_model"]

# Equilibrated singular value / largest below which a direction counts as
# undetermined. Measured 2026-09-25 (tests/test_calc_peak_model_fit.py cases):
# two identical coincident gaussians sit at 3.8e-9 (finite-difference noise);
# the weakest direction of the healthy 3-overlapping-peak fit at 0.14, so
# 1e-6 leaves decades of margin on both sides.
DEGENERATE_RATIO = 1e-6
# Two peaks closer than this fraction of their mean FWHM are flagged as
# overlapping: their heights/widths trade off and the split is weakly defined.
OVERLAP_FWHM_FRACTION = 0.5
_REL_STEP = 1e-6


class _Deadline(Exception):
    pass


def _prepare(
    x: ArrayLike, y: ArrayLike, y_err: ArrayLike | None, x_min: float | None, x_max: float | None,
) -> tuple[NDArray[np.bool_], NDArray[np.float64], NDArray[np.float64],
           NDArray[np.float64] | None, int, int]:
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError("x and y must have the same length")
    ea = None if y_err is None else np.asarray(y_err, dtype=float).ravel()
    if ea is not None and ea.size != xa.size:
        raise ValueError("y_err must have the same length as x and y")
    finite = np.isfinite(xa) & np.isfinite(ya)
    if ea is not None:
        finite &= np.isfinite(ea)
    n_dropped = int((~finite).sum())
    if x_min is not None and x_max is not None and not x_min < x_max:
        raise ValueError("x_min must be less than x_max")
    m = finite.copy()
    if x_min is not None:
        m &= xa >= x_min
    if x_max is not None:
        m &= xa <= x_max
    n_excluded = int((finite & ~m).sum())
    if ea is not None and np.any(ea[m] <= 0):
        raise ValueError(f"y_err must be positive; {int((ea[m] <= 0).sum())} fitted points "
                         "have zero or negative error")
    if m.sum() < 2 or float(np.ptp(xa[m])) <= 0:
        raise ValueError("the fitted x-range needs at least 2 distinct x values")
    return np.asarray(m, dtype=bool), xa, ya, ea, n_dropped, n_excluded


def fit_peak_model(
    x: ArrayLike,
    y: ArrayLike,
    shapes: Sequence[str],
    parameters: list[dict[str, Any]],
    *,
    background: str = "linear",
    y_err: ArrayLike | None = None,
    x_min: float | None = None,
    x_max: float | None = None,
    bg_x_ref: float | None = None,
    max_nfev: int = 1000,
    deadline_s: float | None = None,
) -> dict[str, Any]:
    """Fit peaks of the given ``shapes`` + a polynomial ``background``.

    ``parameters`` must name exactly the model's parameters (``p{i}.center``,
    ``p{i}.height``, ``p{i}.fwhm``..., ``bg.c0``...; see
    :mod:`quantized.calc.peak_model`). Rows with a non-finite x, y or y_err are
    dropped (``n_dropped``); ``x_min``/``x_max`` restrict the fitted points
    (``n_excluded``). Returns ``parameters``, ``free``, ``correlation``,
    per-peak derived ``peaks``, ``background``, ``metrics``,
    ``success``/``message``/``n_evaluations``, ``curves`` on the fitted points
    (x, y, y_err, model, background, components - each peak without
    background - residual y - model, normalized_residual), and ``warnings``.
    """
    m, xa, ya, ea, n_dropped, n_excluded = _prepare(x, y, y_err, x_min, x_max)
    xf, yf = xa[m], ya[m]
    ef = None if ea is None else ea[m]
    xlo, xhi = float(xf.min()), float(xf.max())
    xspan = xhi - xlo
    yscale = float(max(np.ptp(yf), np.max(np.abs(yf)))) or 1.0
    x_ref = 0.5 * (xlo + xhi) if bg_x_ref is None else float(bg_x_ref)
    if not math.isfinite(x_ref):
        raise ValueError("bg_x_ref must be finite")
    model = PeakModel(list(shapes), background, x_ref)
    params = PeakParams(parameters, model.names, xspan, yscale)
    n_points, n_free = int(xf.size), len(params.free)
    if n_points <= n_free:
        raise ValueError(f"{n_points} usable points cannot constrain {n_free} free parameters")
    weighted = ef is not None

    t_end = None if deadline_s is None else time.monotonic() + deadline_s
    count = {"n": 0}
    best: dict[str, Any] = {"cost": math.inf, "x": params.x0()}

    def residuals(xs: NDArray[np.float64]) -> NDArray[np.float64]:
        if t_end is not None and time.monotonic() > t_end:
            raise _Deadline
        count["n"] += 1
        r = model.evaluate(xf, params.full(xs)) - yf
        if ef is not None:
            r = r / ef
        r = np.asarray(r, dtype=float)
        cost = float(np.sum(r**2))
        if cost < best["cost"]:
            best["cost"], best["x"] = cost, np.array(xs, dtype=float)
        return r

    warnings: list[str] = []
    jac: NDArray[np.float64] | None = None
    if n_free:
        try:
            sol = least_squares(residuals, params.x0(), bounds=params.x_bounds(), method="trf",
                                x_scale="jac", max_nfev=max_nfev)
            xs, success, message, jac = sol.x, bool(sol.success), str(sol.message), sol.jac
            if not success or sol.status == 0:
                success = False
                warnings.append(f"the optimiser stopped without converging: {message}")
        except _Deadline:
            xs, success = best["x"], False
            message = f"stopped at the {deadline_s:g} s time limit"
            warnings.append(f"the fit {message}; the best point found is reported "
                            "without uncertainties")
    else:
        xs, success, message = params.x0(), True, "no free parameters"
    t_end = None
    obj = float(np.sum(residuals(xs) ** 2))
    dof = n_points - n_free
    v = params.full(xs)
    if n_dropped:
        warnings.append(f"{n_dropped} rows with a non-finite value were dropped")

    cov, undetermined = _covariance(jac, params, obj / dof)
    at_bound = params.at_bound(v) if jac is not None else [False] * n_free
    no_err = [at_bound[k] or undetermined[k] or cov is None for k in range(n_free)]
    free_pos = {i: k for k, i in enumerate(params.free)}
    _flag(warnings, params, at_bound, "parameters ended on a bound (errors not reported): ")
    _flag(warnings, params, undetermined,
          "the data do not determine these parameters independently (no error reported; "
          "fix or tie some of them): ")

    def stderr(i: int) -> float | None:
        k = free_pos.get(params.root[i])
        if k is None or no_err[k] or cov is None:
            return None
        return _finite(math.sqrt(max(float(cov[k, k]), 0.0)))

    out_params = [{
        "name": n, "value": float(v[i]), "stderr": stderr(i), "vary": i in free_pos,
        "tie": params.tie[i], "at_bound": bool(i in free_pos and at_bound[free_pos[i]]),
    } for i, n in enumerate(params.names)]

    peaks = [_derived(model, params, k, v, cov, no_err, free_pos)
             for k in range(len(model.shapes))]
    _peak_warnings(warnings, peaks, xlo, xhi)

    fit_y = model.evaluate(xf, v)
    resid = yf - fit_y
    return {
        "parameters": out_params,
        "free": [params.names[i] for i in params.free],
        "correlation": _correlation(cov),
        "peaks": peaks,
        "background": {"kind": background, "x_ref": x_ref},
        "weighted": weighted,
        "metrics": _metrics(yf, ef, resid, n_points, n_free),
        "success": success,
        "message": message,
        "n_evaluations": count["n"],
        "x_range": [xlo, xhi],
        "n_dropped": n_dropped,
        "n_excluded": n_excluded,
        "curves": {
            "x": xf.tolist(), "y": yf.tolist(),
            "y_err": None if ef is None else ef.tolist(),
            "model": fit_y.tolist(),
            "background": model.background(xf, v).tolist(),
            "components": [model.component(k, xf, v).tolist() for k in range(len(model.shapes))],
            "residual": resid.tolist(),
            "normalized_residual": None if ef is None else (resid / ef).tolist(),
        },
        "warnings": warnings,
    }


def _covariance(jac: NDArray[np.float64] | None, params: PeakParams,
                red: float) -> tuple[NDArray[np.float64] | None, list[bool]]:
    """Parameter-space covariance of the free parameters + undetermined flags."""
    n_free = len(params.free)
    if jac is None or not n_free:
        return None, [False] * n_free
    d = np.linalg.norm(jac, axis=0)
    d = np.where(d > 0, d, 1.0)
    _, s, vt = np.linalg.svd(jac / d, full_matrices=False)
    smax = float(s[0]) if s.size else 0.0
    weak = s <= DEGENERATE_RATIO * smax if smax > 0 else np.ones_like(s, dtype=bool)
    undetermined = [False] * n_free
    for row in vt[weak]:
        for kk in np.nonzero(np.abs(row) > 1e-3)[0]:
            undetermined[int(kk)] = True
    inv_s2 = np.zeros_like(s)
    inv_s2[~weak] = 1.0 / s[~weak] ** 2
    cov_n = (vt.T * inv_s2) @ vt
    sc = params.scale / d
    cov = np.asarray(cov_n * np.outer(sc, sc) * red, dtype=float)
    return cov, undetermined


_DERIVED = ("center", "height", "fwhm", "area")


def _quantity(key: str, shape: str, p: list[float]) -> float:
    if key == "center":
        return p[0]
    if key == "height":
        return p[1]
    return peak_fwhm(shape, p) if key == "fwhm" else peak_area(shape, p)


def _derived(model: PeakModel, params: PeakParams, k: int, v: NDArray[np.float64],
             cov: NDArray[np.float64] | None, no_err: list[bool],
             free_pos: dict[int, int]) -> dict[str, Any]:
    """Peak ``k``'s centre/height/FWHM/area with delta-method errors."""
    shape, idx = model.shapes[k], model.fields[k]
    vals = [float(v[i]) for i in idx]
    out: dict[str, Any] = {"id": f"p{k}", "shape": shape}
    for key in _DERIVED:
        out[key] = _quantity(key, shape, vals)
        grad = np.zeros(len(params.free))
        touched: set[int] = set()
        for j, i in enumerate(idx):
            pos = free_pos.get(params.root[i])
            if pos is None:
                continue
            h = _REL_STEP * (abs(vals[j]) or float(params.scale[pos]))
            up, dn = list(vals), list(vals)
            up[j] += h
            dn[j] -= h
            dg = (_quantity(key, shape, up) - _quantity(key, shape, dn)) / (2.0 * h)
            if dg != 0.0:
                grad[pos] += dg
                touched.add(pos)
        err: float | None = None
        if touched and cov is not None and not any(no_err[q] for q in touched):
            err = _finite(math.sqrt(max(float(grad @ cov @ grad), 0.0)))
        out[f"{key}_stderr"] = err
    return out


def _peak_warnings(warnings: list[str], peaks: list[dict[str, Any]],
                   xlo: float, xhi: float) -> None:
    for p in peaks:
        if not xlo <= p["center"] <= xhi:
            warnings.append(f"peak {p['id']} centre {p['center']:.6g} lies outside the "
                            f"fitted x-range [{xlo:.6g}, {xhi:.6g}]")
    for a in range(len(peaks)):
        for b in range(a + 1, len(peaks)):
            pa, pb = peaks[a], peaks[b]
            sep = abs(pa["center"] - pb["center"])
            mean_w = 0.5 * (pa["fwhm"] + pb["fwhm"])
            if sep < OVERLAP_FWHM_FRACTION * mean_w:
                warnings.append(
                    f"peaks {pa['id']} and {pb['id']} overlap: separation {sep:.4g} is under "
                    f"{OVERLAP_FWHM_FRACTION:g} x their mean FWHM ({mean_w:.4g}), so their "
                    "split is weakly defined")
    for p in peaks:
        if p["height"] < 0 or p["area"] < 0:
            warnings.append(f"peak {p['id']} has a negative height/area (a dip); set its "
                            "height min to 0 to forbid this")


def _metrics(yf: NDArray[np.float64], ef: NDArray[np.float64] | None,
             resid: NDArray[np.float64], n: int, k: int) -> dict[str, Any]:
    dof = n - k
    ssr = float(np.sum(resid**2))
    if ef is None:
        obj, sst = ssr, float(np.sum((yf - yf.mean()) ** 2))
    else:
        w = 1.0 / ef**2
        ybar = float(np.sum(w * yf) / np.sum(w))
        obj, sst = float(np.sum(w * resid**2)), float(np.sum(w * (yf - ybar) ** 2))
    r2 = 1.0 - obj / sst if sst > 0 else None
    adj = None if r2 is None or n <= 1 else 1.0 - (1.0 - r2) * (n - 1) / dof
    ln = n * math.log(obj / n) if obj > 0 else None
    return {
        "objective": "chi2" if ef is not None else "ssr",
        "n_points": n, "n_free": k, "dof": dof,
        "ssr": ssr, "reduced_ssr": ssr / dof,
        "chi2": obj if ef is not None else None,
        "reduced_chi2": obj / dof if ef is not None else None,
        "r_squared": r2, "adj_r_squared": adj,
        "aic": None if ln is None else ln + 2 * k,
        "bic": None if ln is None else ln + k * math.log(n),
    }


def _flag(warnings: list[str], params: PeakParams, flags: list[bool], head: str) -> None:
    names = [params.names[i] for k, i in enumerate(params.free) if flags[k]]
    if names:
        warnings.append(head + ", ".join(names))


def _correlation(cov: NDArray[np.float64] | None) -> list[list[float | None]]:
    if cov is None:
        return []
    sd = np.sqrt(np.clip(np.diag(cov), 0.0, None))
    with np.errstate(invalid="ignore", divide="ignore"):
        c = cov / np.outer(sd, sd)
    return [[_finite(val) for val in r] for r in c]


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(float(x)) else None
