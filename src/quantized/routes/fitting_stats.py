"""Thin fit-statistics routes: confidence/prediction bands, diagnostics,
model comparison and orthogonal distance regression.

No math here. Each route validates, calls one pure function, and serializes:
``/bands`` -> ``calc.fit_stats.fit_bands``; ``/curve`` -> a display-curve
fit's full arrays by id (routes/_fitresults.py); ``/diagnostics`` ->
``calc.fit_stats.fit_compare`` + ``residual_diagnostics``; ``/compare`` ->
``calc.fit_model_compare.compare_models``; ``/odr`` -> ``calc.fit_odr.odr_fit``; ``/york`` ->
``calc.fit_york.york_fit``.
Split from ``routes/fitting.py`` (at the module ceiling) under the same
``/api/fitting`` prefix. Non-finite values serialize as null.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field, model_validator

from quantized.calc.decimate import decimate_row_indices
from quantized.calc.fit_equation import equation_model
from quantized.calc.fit_model_compare import compare_models
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fit_odr import odr_fit
from quantized.calc.fit_stats import (
    ModelFn,
    fit_bands,
    fit_compare,
    observation_variance_on_grid,
    residual_diagnostics,
)
from quantized.calc.fit_york import york_fit
from quantized.calc.fitting import observation_variance, weights_from_dy
from quantized.routes._errors import call_calc
from quantized.routes._fitresults import resolve_fit_or_409
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class BandsRequest(BaseModel):
    # Exactly one of a registry model name / a custom equation string.
    model: str | None = None
    equation: str | None = None
    params: list[float]
    # The fit's parameter covariance (curve_fit's ``covar``). null when the
    # fit could not estimate one; the bands then come back null.
    covar: list[list[float]] | None = None
    # Grid the bands are evaluated on.
    x: list[float]
    # The fit's point and free-parameter counts; the band's Student-t
    # quantile uses the residual dof n_points - n_free.
    n_points: int
    n_free: int
    # The fit's observation variance (curve_fit's ``MSE``), which the
    # prediction band adds to the curve's own variance. null -> the
    # prediction limits come back null (the confidence band is unaffected).
    mse: float | None = Field(default=None, ge=0.0)
    # A WEIGHTED fit's observations do not share a variance: send the fitted
    # x values and curve_fit's per-point ``obsVar`` instead of ``mse`` and the
    # prediction band uses each grid point's own variance (interpolated
    # between data points, held at the end values outside them --
    # calc.fit_stats.observation_variance_on_grid). null entries = zero-weight
    # points, which are skipped. Takes precedence over ``mse``.
    x_data: list[float] | None = None
    obs_var: list[float | None] | None = None
    # By id (P4 phase 2): a display-curve fit's ``result_id`` stands for
    # ``x_data`` + ``obs_var``, kept server-side (409 once evicted). The
    # eviction fallback resends the fit's own weighting instead, with
    # ``x_data``: ``obs_dy`` (1-sigma errors, -> 1/dy^2 as the fit resolved
    # them) or ``obs_weights`` (a direct weight column), and ``obs_scale``,
    # the fit's s^2 (chiSqRed when errorsScaled, else 1); the route rebuilds
    # obsVar with curve_fit's own s^2/w, so the band is bit-identical.
    result_id: str | None = None
    obs_dy: list[float] | None = None
    obs_weights: list[float] | None = None
    obs_scale: float | None = Field(default=None, ge=0.0)
    level: float = Field(default=0.95, gt=0.0, lt=1.0)


def _model_fcn(model: str | None, equation: str | None, n_params: int) -> ModelFn:
    """Resolve a registry name or an equation string to ``f(x, p) -> y``."""
    if (model is None) == (equation is None):
        raise HTTPException(status_code=422, detail="specify exactly one of model or equation")
    if model is not None:
        if model not in FIT_MODELS:
            raise HTTPException(status_code=422, detail=f"unknown model: {model}")
        name = model

        def registry_fcn(xa: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
            return evaluate(name, xa, pp)

        return registry_fcn
    assert equation is not None  # narrowed by the "exactly one" check above
    fcn, names = call_calc(equation_model, equation)
    if len(names) != n_params:
        raise HTTPException(
            status_code=422,
            detail=f"expected {len(names)} params for this equation, got {n_params}",
        )
    return fcn


def _infinite_gaps(var: Any) -> NDArray[np.float64]:
    """Non-finite variance -> inf, as the by-array path sees it (a JSON null
    decodes to inf there): a zero-weight point is skipped either way."""
    out = np.array(var, dtype=float)
    out[~np.isfinite(out)] = np.inf
    return out


def _band_obs_var(req: BandsRequest) -> tuple[Any, Any] | None:
    """The fit's ``(x_data, obsVar)`` for a weighted band, or None (``mse``)."""
    if req.x_data is not None and req.obs_var is not None:
        if len(req.x_data) != len(req.obs_var):
            raise HTTPException(
                status_code=422, detail="x_data and obs_var must be the same length")
        return req.x_data, [float("inf") if v is None else v for v in req.obs_var]
    if req.result_id is not None:
        kept = resolve_fit_or_409(req.result_id, full_curve=True)
        return None if kept.obs_var is None else (kept.x, _infinite_gaps(kept.obs_var))
    weights: Any = req.obs_weights
    if req.x_data is None or req.obs_scale is None or (req.obs_dy is None and weights is None):
        return None
    if req.obs_dy is not None:
        weights = call_calc(weights_from_dy, req.obs_dy, len(req.x_data))
    w = np.asarray(weights, dtype=float).ravel()
    if w.size != len(req.x_data):
        raise HTTPException(status_code=422, detail="x_data and the weights differ in length")
    return req.x_data, _infinite_gaps(observation_variance(w, req.obs_scale))


@router.post("/bands")
def bands(req: BandsRequest) -> dict[str, Any]:
    """Confidence and prediction bands around a fitted curve (fitting.fitBands)."""
    fcn = _model_fcn(req.model, req.equation, len(req.params))
    mse: Any = req.mse
    obs = _band_obs_var(req)
    if obs is not None:
        mse = call_calc(observation_variance_on_grid, obs[0], obs[1], req.x)
    out = call_calc(
        fit_bands, req.x, fcn, req.params, req.covar, req.n_points, req.n_free,
        level=req.level, mse=mse,
    )
    return to_jsonable(out)  # type: ignore[no-any-return]


class CurveRequest(BaseModel):
    # A display-curve fit's ``resultId`` (routes/_fitresults.py).
    result_id: str
    # Also return the weighted fit's per-point ``obsVar`` (null unweighted).
    obs_var: bool = False


@router.post("/curve")
def curve(req: CurveRequest) -> dict[str, Any]:
    """The full-resolution curve a display-curve fit left off the wire: its
    ``yFit`` exactly as the full response carries it. 409 when evicted; the
    client then evaluates the model at its own x (``/bands``, covar null)."""
    kept = resolve_fit_or_409(req.result_id, full_curve=True)
    out: dict[str, Any] = {"yFit": to_jsonable(kept.y_fit)}
    if req.obs_var:
        out["obsVar"] = None if kept.obs_var is None else to_jsonable(kept.obs_var)
    return out


class DiagnosticsRequest(BaseModel):
    # EITHER the arrays (y + residuals [+ weights]) OR the ``result_id`` of a
    # lean fit (routes/_fitresults.py), which holds all three server-side --
    # 39 MB up per call at 1M rows otherwise. Arrays win when both are sent.
    # An unknown id is a 409; the client then resends the arrays.
    y: list[float] | None = None
    residuals: list[float] | None = None
    result_id: str | None = None
    # By id only: whether the fit's own weights apply (a by-array caller
    # decides by sending ``weights`` or not).
    use_weights: bool = True
    # Free (fitted) parameter count of the model the residuals came from.
    n_params: int
    # The fit's least-squares weights (1/dy^2, or a direct weight column), so
    # AIC/AICc/BIC are computed on the same weighted chi^2 as the fit's own.
    weights: list[float] | None = None


    # Display budget for the Q-Q pairs (P4): thinned to the per-bucket
    # min/max of the sorted residuals (calc.decimate), which keeps both ends
    # and every bucket's extent. None = every pair, as before. The statistics
    # are always computed on every point.
    qq_points: int | None = Field(default=None, ge=1, le=20_000)

    @model_validator(mode="after")
    def _arrays_or_id(self) -> DiagnosticsRequest:
        if self.result_id is None and (self.y is None or self.residuals is None):
            raise ValueError("send y and residuals, or a fit's result_id")
        return self


@router.post("/diagnostics")
def diagnostics(req: DiagnosticsRequest) -> dict[str, Any]:
    """Goodness-of-fit metrics and residual diagnostics for one fit."""
    y: Any = req.y
    residuals: Any = req.residuals
    weights: Any = req.weights
    if y is None or residuals is None:
        assert req.result_id is not None  # the validator above
        kept = resolve_fit_or_409(req.result_id)
        y, residuals = kept.y, kept.residuals
        weights = kept.weights if req.use_weights else None
    if len(y) != len(residuals):
        raise HTTPException(status_code=422, detail="y and residuals must have the same length")
    resid = call_calc(residual_diagnostics, residuals, weights)
    if req.qq_points is not None and len(resid["qqY"]) > 0:
        rows = decimate_row_indices([np.asarray(resid["qqY"], dtype=float)], req.qq_points)
        resid["qqX"], resid["qqY"] = resid["qqX"][rows], resid["qqY"][rows]
    return {
        "compare": to_jsonable(call_calc(fit_compare, y, residuals, req.n_params, weights=weights)),
        "residuals": to_jsonable(resid),
    }


class CompareEquation(BaseModel):
    name: str
    equation: str
    guesses: list[float] | None = None


class CompareRequest(BaseModel):
    x: list[float]
    y: list[float]
    models: list[str] | None = None
    equations: list[CompareEquation] | None = None
    # F-test baseline; null -> the candidate with the fewest free parameters.
    reference: str | None = None


@router.post("/compare")
def compare(req: CompareRequest) -> dict[str, Any]:
    """Fit two or more models to one selection and compare them.

    Per-candidate fit failures come back as ``error`` entries (curated fit
    diagnostics, as for ``/scan`` -- see SECURITY.md); only invalid input is
    a 422.
    """
    equations = [e.model_dump() for e in req.equations] if req.equations else None
    out = call_calc(
        compare_models, req.x, req.y, models=req.models, equations=equations,
        reference=req.reference,
    )
    # NOTE(codeql py/stack-trace-exposure): reviewed, by design -- SECURITY.md.
    return to_jsonable(out)  # type: ignore[no-any-return]


class OdrRequest(BaseModel):
    x: list[float]
    y: list[float]
    # sigma_y^2 / sigma_x^2; ignored when both error columns are given.
    lambda_: float = Field(default=1.0, alias="lambda")
    x_error: list[float] | None = None
    y_error: list[float] | None = None


@router.post("/odr")
def odr(req: OdrRequest) -> dict[str, Any]:
    """Orthogonal distance (Deming) straight-line fit, errors in x and y."""
    out = call_calc(
        odr_fit, req.x, req.y, lambda_=req.lambda_, x_error=req.x_error, y_error=req.y_error
    )
    return to_jsonable(out)  # type: ignore[no-any-return]


class YorkRequest(BaseModel):
    x: list[float]
    y: list[float]
    # One 1-sigma error per point, > 0 (the calc layer refuses anything else).
    x_error: list[float]
    y_error: list[float]
    # Per-point X-Y error correlation in (-1, 1); omitted = uncorrelated.
    rho: list[float] | None = None


@router.post("/york")
def york(req: YorkRequest) -> dict[str, Any]:
    """York straight-line fit with a separate X and Y error for every point."""
    out = call_calc(york_fit, req.x, req.y, req.x_error, req.y_error, rho=req.rho)
    return to_jsonable(out)  # type: ignore[no-any-return]
