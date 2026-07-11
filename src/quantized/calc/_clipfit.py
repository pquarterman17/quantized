"""Shared Lieber-Mahadevan-Jansen iterative clip-fit loop (MAIN #8c).

:func:`quantized.calc.baseline.baseline_modpoly` and
:func:`quantized.calc.backgrounds.xrd_low_angle_background` run the same
iterative clip discipline (Lieber & Mahadevan-Jansen, Appl. Spectrosc. 57,
1363 (2003)): fit a model to the working signal, clamp the signal to
``min(signal, fit)``, and refit until the RMS change relative to the data
range drops below tolerance. Only the model fit differs between the two —
a polynomial in normalized sample index vs a linear least-squares solve on
a hyperbolic basis — so the loop lives here ONCE, parameterized by the fit
callable. The operation sequence (clip, RMS, ``rms / y_range < tol``
convergence test, 1-based iteration count) is verbatim from both callers:
``baseline_modpoly`` is golden-parity-tested against frozen MATLAB output,
so this loop must stay bit-identical.

Pure layer: ndarray in -> results out. No fastapi/pydantic imports.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import NamedTuple

import numpy as np
from numpy.typing import NDArray

__all__ = ["ClipFitResult", "_iterative_clip_fit"]

# One model fit over the current working signal: returns ``(coeffs, fit)``
# where ``fit`` is the model evaluated on the full grid.
FitFn = Callable[[NDArray[np.float64]], tuple[NDArray[np.float64], NDArray[np.float64]]]


class ClipFitResult(NamedTuple):
    """Final state of the clip-fit loop."""

    coeffs: NDArray[np.float64]
    fit: NDArray[np.float64]
    n_iter: int
    converged: bool


def _iterative_clip_fit(
    y: NDArray[np.float64],
    fit_fn: FitFn,
    *,
    max_iter: int,
    tol: float,
    y_range: float,
    init: tuple[NDArray[np.float64], NDArray[np.float64]],
) -> ClipFitResult:
    """Iteratively fit and clip the working signal to ``min(signal, fit)``.

    Each iteration fits ``fit_fn`` to the working copy of ``y``, clamps the
    copy to ``min(copy, fit)``, and stops (``converged=True``) once the RMS
    of the clip step falls below ``tol * y_range``. ``init`` supplies the
    ``(coeffs, fit)`` returned when the loop body never runs (``max_iter``
    < 1) — callers preserve their exact pre-refactor initial state through
    it (``baseline_modpoly`` a pre-loop polynomial fit,
    ``xrd_low_angle_background`` zeros).
    """
    coeffs, fit = init
    y_work = y.copy()
    converged = False
    n_iter = 0
    for it in range(1, max_iter + 1):
        n_iter = it
        coeffs, fit = fit_fn(y_work)
        y_new = np.asarray(np.minimum(y_work, fit), dtype=float)
        rms = math.sqrt(float(np.mean((y_new - y_work) ** 2)))
        y_work = y_new
        if rms / y_range < tol:
            converged = True
            break
    return ClipFitResult(coeffs, fit, n_iter, converged)
