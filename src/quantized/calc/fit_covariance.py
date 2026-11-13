"""Parameter covariance for the least-squares fitters: (JᵀWJ)⁻¹ and Hessian.

Pure calc layer, shared by ``calc.fitting.curve_fit`` and
``calc.global_curve_fit``.

Two estimators, both selectable (fitting audit, finding 3):

* ``"jtj"`` -- ``cov = (JᵀWJ)⁻¹ · s²``, with ``J`` the model Jacobian in the
  *bounded* parameters (central differences). This is the Gauss-Newton
  covariance that Origin, scipy ``curve_fit`` (``pcov``) and statsmodels
  report. Default for every fit.
* ``"hessian"`` -- ``cov = (H/2)⁻¹ · s²`` from a central-difference Hessian of
  the weighted SSR in the *free* (transformed) parameters, mapped back through
  the bound transform's Jacobian. This is MATLAB ``fitting.curveFit``'s method;
  the golden parity tests pin it explicitly. It adds the residual-curvature
  term the Gauss-Newton form drops, so the two agree for small residuals and
  differ for poor fits.

``s²`` is the reduced chi-square when the errors are scaled (Origin's
"Scale Error with sqrt(Reduced Chi-Sqr)", on by default, and always on for an
unweighted fit, where there is no other variance estimate) and 1 when not
(scipy ``absolute_sigma=True``: the weights are taken as true 1/sigma²).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np
from numpy.typing import NDArray

__all__ = ["COVARIANCE_METHODS", "hessian_covariance", "jtj_covariance", "residual_jacobian"]

COVARIANCE_METHODS = ("jtj", "hessian")
_EPS = float(np.finfo(float).eps)


def _resolved_step(
    resid: Callable[[NDArray[np.float64]], NDArray[np.float64]],
    p: NDArray[np.float64],
    k: int,
    r0: NDArray[np.float64],
    ref: float,
    sign: float,
) -> float:
    """Difference step for ``p[k]``: ``eps^(1/3)·|p|``, grown x10 until the
    residual change it causes is itself resolved (``>= eps^(1/3)·ref``).

    A step proportional to ``|p|`` collapses for a parameter that merely
    happens to sit near zero (a slope of 4e-6 on unit-scale data): the
    residual then changes by less than its own round-off and the standard
    error came out 1.7e-3 wrong (review item 14). Growing the step until the
    EFFECT is measurable needs no guess about the parameter's "natural"
    scale: a genuinely small-scale parameter (tau = 1e-6 s) already has a
    resolved effect at the first step and is not touched.
    """
    step = _EPS ** (1 / 3)
    h = float(step * abs(float(p[k])) if p[k] != 0 else step * 1e-8)
    target = step * ref
    for _ in range(24):
        trial = p.copy()
        trial[k] += sign * h
        diff = np.asarray(resid(trial), dtype=float) - r0
        if not np.all(np.isfinite(diff)) or float(np.linalg.norm(diff)) >= target:
            break
        h *= 10.0
    return h


def residual_jacobian(
    resid: Callable[[NDArray[np.float64]], NDArray[np.float64]],
    p: NDArray[np.float64],
    idx: Sequence[int],
    lower: NDArray[np.float64] | None = None,
    upper: NDArray[np.float64] | None = None,
    scale: float = 0.0,
) -> NDArray[np.float64]:
    """Finite-difference Jacobian of ``resid(p)`` w.r.t. ``p[idx]``.

    Central differences with the step of ``_resolved_step``: ``eps^(1/3)·|p|``
    at least, grown until the residual change is resolved against
    ``max(|resid|, scale)`` (``scale`` = the norm of the weighted data, so a
    perfect fit, whose residual is ~0, still has a reference). A parameter
    within one step of its ``lower``/``upper`` bound uses a one-sided
    difference that stays inside the box, so a model only defined there
    (``sqrt(w)`` with ``w >= 0``) is never evaluated outside it.
    """
    p = np.asarray(p, dtype=float)
    r0 = np.asarray(resid(p), dtype=float)
    jac = np.zeros((r0.size, len(idx)))
    ref = max(float(np.linalg.norm(r0)), float(scale), np.finfo(float).tiny)
    for j, k in enumerate(idx):
        lo = -np.inf if lower is None else float(lower[k])
        hi = np.inf if upper is None else float(upper[k])
        sign = -1.0 if p[k] + _EPS ** (1 / 3) * max(abs(float(p[k])), 1e-300) > hi else 1.0
        h = _resolved_step(resid, p, k, r0, ref, sign)
        up, dn = p.copy(), p.copy()
        up[k] += h
        dn[k] -= h
        if up[k] > hi and dn[k] >= lo:  # backward difference
            jac[:, j] = (r0 - np.asarray(resid(dn), dtype=float)) / h
        elif dn[k] < lo and up[k] <= hi:  # forward difference
            jac[:, j] = (np.asarray(resid(up), dtype=float) - r0) / h
        else:
            jac[:, j] = (
                np.asarray(resid(up), dtype=float) - np.asarray(resid(dn), dtype=float)
            ) / (2 * h)
    return jac


def jtj_covariance(jac: NDArray[np.float64], s2: float) -> NDArray[np.float64] | None:
    """``(JᵀJ)⁻¹ · s2`` via the SVD of ``J`` (``J`` already carries ``√w``).

    ``None`` when ``J`` is rank deficient (a parameter the data cannot
    constrain) -- the errors are then undefined, not huge.
    """
    if jac.size == 0 or not np.all(np.isfinite(jac)):
        return None
    _, sv, vt = np.linalg.svd(jac, full_matrices=False)
    if sv.size == 0 or sv[-1] <= _EPS * max(jac.shape) * sv[0]:
        return None
    vs = vt.T / sv
    return np.asarray(vs @ vs.T * s2, dtype=float)


def hessian_covariance(
    hess: NDArray[np.float64], s2: float, bound_jac: NDArray[np.float64]
) -> NDArray[np.float64] | None:
    """MATLAB curveFit covariance: ``inv(H/2) · s2`` in free space, mapped to
    bounded space with the diagonal bound-transform Jacobian. ``None`` when the
    Hessian is singular or yields a negative variance."""
    try:
        cov_free = np.asarray(np.linalg.inv(hess / 2) * s2, dtype=float)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.diag(cov_free) >= 0):
        return None
    jmat = np.diag(bound_jac)
    return np.asarray(jmat @ cov_free @ jmat.T, dtype=float)
