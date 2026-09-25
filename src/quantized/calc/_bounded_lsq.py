r"""Shared bounded least-squares scaffold (private; refl_fit + peak_model_fit).

Pure calc layer. Two pieces both fitters need, owned once:

* :func:`solve_bounded` - scipy's trust-region-reflective ``least_squares``
  over a caller-scaled free vector, with a wall-clock deadline checked before
  EVERY residual evaluation (``>=``, so a zero budget stops on the first call
  even where the monotonic clock ticks coarsely, ~15.6 ms on Windows), the
  best point seen kept for a deadline stop, and an evaluation count that
  includes the Jacobian's finite-difference calls.
* :func:`pinv_covariance` - ``(J^T J)^+`` from the Jacobian's SVD, dropping
  directions whose singular value is below ``degenerate_ratio`` times the
  largest and flagging every parameter with a material share (>1e-3) of such
  a direction as undetermined. ``equilibrate`` first scales each column to
  unit norm, which makes the test independent of parameter units; refl_fit
  keeps the raw Jacobian of its bound-normalised parameters.

Each fitter keeps its own scaling, threshold, warning text and reporting.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares

__all__ = ["BoundedFit", "pinv_covariance", "solve_bounded"]

Residuals = Callable[[NDArray[np.float64]], NDArray[np.float64]]
Status = Literal["converged", "not_converged", "deadline", "no_free"]


class _Deadline(Exception):
    pass


@dataclass
class BoundedFit:
    """Outcome of :func:`solve_bounded`. ``jac`` is None after a deadline stop
    or with no free parameters. :meth:`residuals` evaluates (and counts)
    without the deadline, for the caller's final pass."""

    fun: Residuals
    x: NDArray[np.float64]
    success: bool
    message: str
    status: Status
    jac: NDArray[np.float64] | None = None
    t_end: float | None = None
    n_evaluations: int = 0
    best_cost: float = math.inf
    best_x: NDArray[np.float64] = field(default_factory=lambda: np.zeros(0))

    def tracked(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        if self.t_end is not None and time.monotonic() >= self.t_end:
            raise _Deadline
        self.n_evaluations += 1
        r = self.fun(x)
        cost = float(np.sum(r**2))
        if cost < self.best_cost:
            self.best_cost, self.best_x = cost, np.array(x, dtype=float)
        return r

    def residuals(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        self.t_end = None
        return self.tracked(x)


def solve_bounded(
    fun: Residuals,
    x0: NDArray[np.float64],
    bounds: tuple[NDArray[np.float64] | float, NDArray[np.float64] | float],
    *,
    max_nfev: int,
    deadline_s: float | None,
) -> BoundedFit:
    """Minimise ``sum(fun(x)**2)`` within ``bounds`` (TRF, ``x_scale="jac"``)."""
    fit = BoundedFit(fun=fun, x=x0, success=True, message="no free parameters",
                     status="no_free", best_x=np.array(x0, dtype=float))
    if not x0.size:
        return fit
    fit.t_end = None if deadline_s is None else time.monotonic() + deadline_s
    try:
        sol = least_squares(fit.tracked, x0, bounds=bounds, method="trf",
                            x_scale="jac", max_nfev=max_nfev)
    except _Deadline:
        fit.x, fit.success, fit.status = fit.best_x, False, "deadline"
        fit.message = f"stopped at the {deadline_s:g} s time limit"
    else:
        # scipy: success is status > 0; status 0 is the max_nfev budget running out.
        fit.x, fit.success, fit.message = sol.x, bool(sol.success), str(sol.message)
        fit.jac = sol.jac
        fit.status = "converged" if fit.success else "not_converged"
    fit.t_end = None
    return fit


def pinv_covariance(
    jac: NDArray[np.float64], *, degenerate_ratio: float, equilibrate: bool,
) -> tuple[NDArray[np.float64], NDArray[np.bool_]]:
    """Unscaled ``(J^T J)^+`` in the solver's coordinates + undetermined flags.

    Callers multiply by their reduced objective and parameter scales."""
    d = np.ones(jac.shape[1])
    if equilibrate:
        norms = np.linalg.norm(jac, axis=0)
        d = np.asarray(np.where(norms > 0, norms, 1.0), dtype=float)
    _, s, vt = np.linalg.svd(jac / d if equilibrate else jac, full_matrices=False)
    smax = float(s[0]) if s.size else 0.0
    weak = s <= degenerate_ratio * smax if smax > 0 else np.ones_like(s, dtype=bool)
    undetermined = np.zeros(jac.shape[1], dtype=bool)
    for row in vt[weak]:
        undetermined[np.abs(row) > 1e-3] = True
    inv_s2 = np.zeros_like(s)
    inv_s2[~weak] = 1.0 / s[~weak] ** 2
    cov = (vt.T * inv_s2) @ vt
    if equilibrate:
        cov = cov / np.outer(d, d)
    return np.asarray(cov, dtype=float), undetermined
