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

from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field, model_validator

from quantized.calc.fitting import weights_from_dy


class FitOptions(BaseModel):
    # Instrumental weighting: per-point 1-sigma errors -> weights 1/dy^2.
    dy: list[float] | None = None
    # Direct weighting: the weight column used as w as given.
    weights: list[float] | None = None
    # Weights by channel (plans/LARGE_PAYLOAD_PLAN.md): with a dataset row
    # selection (routes/_datasetrows.XYSource) the weights may name the
    # dataset's own column instead of riding as an array: ``dy_channel`` is
    # ``|column|`` as ``dy`` (the client's error-column modes take the abs),
    # ``weights_channel`` the column as ``weights``. Read at the fit's rows.
    dy_channel: int | None = Field(default=None, ge=0)
    weights_channel: int | None = Field(default=None, ge=0)
    # Parameter errors: "jtj" = (J'WJ)^-1 * s^2 (Origin / scipy curve_fit,
    # the default) or "hessian" (MATLAB curveFit's SSR-Hessian method).
    covariance: Literal["jtj", "hessian"] = "jtj"
    # Origin "Scale Error with sqrt(Reduced Chi-Sqr)" (default on). Off: the
    # weights are absolute 1/sigma^2. Ignored by an unweighted fit, which
    # always scales (there is no other variance estimate).
    scale_errors: bool = True
    # Statistics definitions. 2 (default) = the current ones
    # (docs/fitting_statistics.md). 1 = those of results saved before
    # 2026-11 -- Hessian errors, weighted RMSE, AIC without the weight term --
    # so recomputing an old saved fit does not silently change what its
    # numbers mean; the client asks for 1 only for a spec that predates the
    # version field, until the user updates it.
    stats_version: Literal[1, 2] = 2
    # Lean response (P4, plans/LARGE_PAYLOAD_PLAN.md): false leaves the
    # per-point ``residuals`` (exactly y - yFit, rebuilt bit for bit by the
    # client) off the wire and returns a ``resultId`` that /diagnostics takes
    # instead of the arrays (routes/_fitresults.py). Default true: unchanged.
    return_residuals: bool = True
    # Display curve (P4 phase 2): with ``return_residuals: false``, a point
    # budget leaves the full ``yFit`` (and a weighted fit's ``obsVar``) off
    # the wire too and returns ``yFitDisplay`` -- the per-bucket min/max rows
    # of the curve (calc.decimate.display_row_indices) -- for the overlay. The
    # full arrays stay under ``resultId`` (``/curve``, ``/bands`` by id).
    # Ignored without ``return_residuals: false``; None = full ``yFit``.
    display_points: int | None = Field(default=None, ge=16, le=20_000)
    # Solver limits (Preferences ▸ Fitting, owner decision 2026-11-25). None =
    # the calc defaults (5000 iterations per free parameter, tol_fun 1e-12,
    # tol_x 1e-10), so a request that omits them is unchanged. Bounds are the
    # provisional ranges (owner to confirm); nothing outside them is solved.
    max_iter_per_param: int | None = Field(default=None, ge=100, le=1_000_000)
    tol_fun: float | None = Field(default=None, ge=1e-15, le=1e-3)
    tol_x: float | None = Field(default=None, ge=1e-15, le=1e-3)

    @model_validator(mode="after")
    def _one_weighting(self) -> FitOptions:
        if self.dy is not None and self.dy_channel is not None:
            raise ValueError("send dy or dy_channel, not both")
        if self.weights is not None and self.weights_channel is not None:
            raise ValueError("send weights or weights_channel, not both")
        return self


def open_bounds(values: list[float | None] | None, fill: float) -> list[float] | None:
    """A request's bound list with ``null`` -> ``fill`` (``-inf`` / ``+inf``).

    JSON cannot carry Infinity: a browser serialises an open bound as
    ``null``. ``/fit`` used to type its bounds ``list[float]`` and answered
    422 to exactly that -- every registry-model fit with custom start values
    and one open bound (found in the live check).
    """
    return None if values is None else [fill if v is None else v for v in values]


def stats_kwargs(opts: FitOptions) -> dict[str, Any]:
    """``curve_fit`` keywords for the request's covariance/scaling/statistics."""
    legacy = opts.stats_version == 1
    out: dict[str, Any] = {
        "covariance": "hessian" if legacy else opts.covariance,
        "scale_errors": opts.scale_errors,
        "legacy_metrics": legacy,
    }
    # Only what the request set: an omitted limit leaves curve_fit's own default.
    for name in ("max_iter_per_param", "tol_fun", "tol_x"):
        if (value := getattr(opts, name)) is not None:
            out[name] = value
    return out


def resolve_weights(
    opts: FitOptions, n: int, dy: list[float] | None = None, weights: list[float] | None = None,
) -> NDArray[np.float64] | list[float] | None:
    """The fit weights for ``opts``: ``dy`` first (instrumental), then the
    direct ``weights`` column, else ``None`` (unweighted). ``dy`` / ``weights``
    are the columns gathered for ``dy_channel`` / ``weights_channel``."""
    dy = opts.dy if dy is None else dy
    if dy is not None:
        return weights_from_dy(dy, n)
    return opts.weights if weights is None else weights
