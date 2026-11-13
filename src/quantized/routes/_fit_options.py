"""Shared fit-request options: weighting, error scaling and the covariance
method, for ``/fit`` and ``/equation/fit`` (routes/fitting.py).

Thin adapter only: the conventions themselves live in ``calc.fitting``
(``weights_from_dy``, ``curve_fit``) and ``calc.fit_covariance``.

Weighting modes (Origin's names):

* none -- neither ``dy`` nor ``weights``;
* instrumental -- ``dy``: per-point 1-sigma errors, weights ``1/dy²`` (the
  canonical convention shared with ``/scan``); takes precedence;
* direct -- ``weights``: a weight column used as ``w`` as given (each entry
  finite and >= 0, not all zero).
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel

from quantized.calc.fitting import weights_from_dy


class FitOptions(BaseModel):
    # Instrumental weighting: per-point 1-sigma errors -> weights 1/dy^2.
    dy: list[float] | None = None
    # Direct weighting: the weight column used as w as given.
    weights: list[float] | None = None
    # Parameter errors: "jtj" = (J'WJ)^-1 * s^2 (Origin / scipy curve_fit,
    # the default) or "hessian" (MATLAB curveFit's SSR-Hessian method).
    covariance: Literal["jtj", "hessian"] = "jtj"
    # Origin "Scale Error with sqrt(Reduced Chi-Sqr)" (default on). Off: the
    # weights are absolute 1/sigma^2. Ignored by an unweighted fit, which
    # always scales (there is no other variance estimate).
    scale_errors: bool = True


def resolve_weights(opts: FitOptions, n: int) -> NDArray[np.float64] | list[float] | None:
    """The fit weights for ``opts``: ``dy`` first (instrumental), then the
    direct ``weights`` column, else ``None`` (unweighted)."""
    if opts.dy is not None:
        return weights_from_dy(opts.dy, n)
    return opts.weights
