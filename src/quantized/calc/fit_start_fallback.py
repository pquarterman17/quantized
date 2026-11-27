"""Fit from the auto-guess, and from the catalogue start when that fit is poor.

Pure calc layer. An automatic initial guess is a heuristic: on some shapes it
lands in a local minimum, or in a degenerate corner where a parameter never
moves, although the same fit converges from the model's catalogue start values
(``FIT_MODELS[name]["p0"]``). :func:`fit_with_start_fallback` runs the
auto-guess fit first; when :func:`fit_is_poor` says it did badly it also fits
from the catalogue start and keeps whichever has the LOWER residual sum of
squares. A fit that was not poor is returned untouched, so no good answer
changes; a poor one is only ever replaced by a strictly better one.

A fit is poor when any of these holds:

* ``exitFlag == 0``: the optimizer did not converge, a free parameter stalled
  at its start, the model is undefined at the optimum, or R² < 0 (all of these
  are already reported in ``warnings``);
* a fitted parameter is not finite, or has run away to more than
  :data:`RUNAWAY` times the larger of 1 and its catalogue start;
* (unweighted fits of at least :data:`MIN_NOISE_POINTS` points) the residual
  sum of squares exceeds :data:`NOISE_FACTOR` times the noise floor the data
  itself implies. The floor is ``n * s**2`` with ``s**2`` the mean of
  ``(y[i-1] - 2 y[i] + y[i+1])**2 / 6`` over x-sorted points: the second
  difference of white noise has variance ``6 sigma**2``, and curvature of the
  signal only raises the estimate, so this errs towards "not poor".

The result carries ``start``: ``"auto"`` or ``"catalogue"``, the start whose
fit was kept. When the catalogue start won, ``warnings`` also says so (it does
not change ``exitFlag``: the kept fit's own convergence decides that).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

__all__ = ["MIN_NOISE_POINTS", "NOISE_FACTOR", "RUNAWAY", "fit_is_poor", "fit_with_start_fallback"]

NOISE_FACTOR = 2.0
MIN_NOISE_POINTS = 12
RUNAWAY = 1e6

FitRun = Callable[[Sequence[float]], dict[str, Any]]


def _noise_floor_ssr(x: ArrayLike, y: ArrayLike) -> float | None:
    """Residual sum of squares a perfect model would leave, from the data alone."""
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    ok = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[ok], yv[ok]
    if yv.size < MIN_NOISE_POINTS:
        return None
    ys = yv[np.argsort(xv, kind="stable")]
    d2 = ys[:-2] - 2.0 * ys[1:-1] + ys[2:]
    return float(yv.size * np.mean(d2**2) / 6.0)


def fit_is_poor(
    result: dict[str, Any],
    p0_catalogue: Sequence[float],
    x: ArrayLike,
    y: ArrayLike,
    *,
    weighted: bool = False,
) -> bool:
    """Whether ``result`` (a ``curve_fit`` dict) warrants trying another start."""
    if result["exitFlag"] == 0:
        return True
    params = np.asarray(result["params"], dtype=float)
    if not bool(np.all(np.isfinite(params))):
        return True
    scale = np.maximum(1.0, np.abs(np.asarray(p0_catalogue, dtype=float)))
    if bool(np.any(np.abs(params) > RUNAWAY * scale)):
        return True
    if weighted:
        return False
    floor = _noise_floor_ssr(x, y)
    return floor is not None and float(result["chiSq"]) > NOISE_FACTOR * floor


def fit_with_start_fallback(
    run: FitRun,
    p0_auto: Sequence[float],
    p0_catalogue: Sequence[float],
    x: ArrayLike,
    y: ArrayLike,
    *,
    weighted: bool = False,
) -> dict[str, Any]:
    """``run(p0)`` from the auto-guess, retried from the catalogue start if poor.

    ``run`` fits with every request option already bound and returns the
    ``curve_fit`` dict. Keeps the fit with the lower ``chiSq`` (the residual sum
    of squares the fit minimises, weighted when the fit is). If the catalogue
    fit raises, or is not finite, the auto-guess fit stands.
    """
    best = run(p0_auto)
    best["start"] = "auto"
    if list(p0_auto) == list(p0_catalogue) or not fit_is_poor(
        best, p0_catalogue, x, y, weighted=weighted
    ):
        return best
    try:
        alt = run(p0_catalogue)
    except (ValueError, ArithmeticError, np.linalg.LinAlgError):
        return best
    alt_ssr, best_ssr = float(alt["chiSq"]), float(best["chiSq"])
    if not math.isfinite(alt_ssr) or (math.isfinite(best_ssr) and alt_ssr >= best_ssr):
        return best
    alt["start"] = "catalogue"
    alt["warnings"] = [
        *alt["warnings"],
        "the auto-guess start fitted poorly, so the model's catalogue start values were "
        f"used instead (residual sum of squares {alt_ssr:.6g} versus {best_ssr:.6g})",
    ]
    return alt
