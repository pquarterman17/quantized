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


def residual_jacobian(
    resid: Callable[[NDArray[np.float64]], NDArray[np.float64]],
    p: NDArray[np.float64],
    idx: Sequence[int],
    lower: NDArray[np.float64] | None = None,
    upper: NDArray[np.float64] | None = None,
) -> NDArray[np.float64]:
    """Finite-difference Jacobian of ``resid(p)`` w.r.t. ``p[idx]``.

    Central differences with step ``eps^(1/3) · |p|`` (``eps^(1/3)`` for a
    zero parameter), the round-off/truncation optimum. A parameter within one
    step of its ``lower``/``upper`` bound uses a one-sided difference that
    stays inside the box, so a model only defined there (``sqrt(w)`` with
    ``w >= 0``) is never evaluated outside it.
    """
    p = np.asarray(p, dtype=float)
    r0 = np.asarray(resid(p), dtype=float)
    jac = np.zeros((r0.size, len(idx)))
    step = _EPS ** (1 / 3)
    for j, k in enumerate(idx):
        h = step * abs(float(p[k])) if p[k] != 0 else step
        lo = -np.inf if lower is None else float(lower[k])
        hi = np.inf if upper is None else float(upper[k])
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
