"""Thin baseline routes: estimate a slowly-varying background under a signal.

Inputs are ``x``/``y`` (or ``y``) OR a dataset handle + channels + rows, and
every route has the opt-in lean response (``LeanBaseline``): see
plans/LARGE_PAYLOAD_PLAN.md.

Wraps ``calc.baseline`` + ``calc.backgrounds``. ALS / rolling-ball / modpoly
operate on ``y`` alone; ``estimate`` (SNIP / polynomial), Shirley, the anchor
baseline and the XRD low-angle model need ``x`` too. Methods with iteration
state also return an ``info`` dict (chosen window / iteration count / coeffs).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.backgrounds import (
    anchor_baseline,
    shirley_background,
    xrd_low_angle_background,
)
from quantized.calc.baseline import (
    baseline_als,
    baseline_modpoly,
    baseline_rolling_ball,
    estimate_background,
    fit_region_background,
)
from quantized.routes._arrayresults import lean_array_fields
from quantized.routes._datasetrows import XYSource, YSource, source_xy, source_y
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import jsonify, to_jsonable

router = APIRouter(prefix="/api/baseline", tags=["baseline"], route_class=OffloopJSONRoute)


class LeanBaseline(BaseModel):
    """Opt-in lean response (P4 phase 4, routes/_arrayresults.py): false
    leaves the full ``baseline`` off the wire and returns a ``resultId``
    (fetch it whole from ``/api/results/array`` when the user subtracts it),
    plus ``baselineDisplay`` when ``display_points`` is set. Default true:
    the response is unchanged."""

    return_baseline: bool = True
    display_points: int | None = Field(default=None, ge=16, le=20_000)


def _baseline_body(
    bg: Any, req: LeanBaseline, extra: dict[str, Any] | None = None, key: str = "baseline"
) -> dict[str, Any]:
    if req.return_baseline:
        return {key: jsonify(bg), **(extra or {})}
    return {
        **(extra or {}),
        **lean_array_fields("baseline", "baseline", bg, req.display_points),
    }


class EstimateRequest(LeanBaseline, XYSource):
    method: str = "snip"
    max_window_deg: float = 2.0
    # calc.baseline._snip_background ends in `for _ in range(passes):`, each
    # pass a concatenate+convolve over the whole array -- unbounded, this
    # wedges a worker thread forever (smooth_passes=1e9 never returns;
    # measured 1e4 passes ~0.04s on n=2000). 10_000 is >3000x the default.
    smooth_passes: int = Field(3, ge=0, le=10_000)
    poly_degree: int = 4  # internally clamped to n//3-1 in _poly_background; no hang risk
    iterative: bool = False
    # calc.baseline._iterative_refine's outer `for _ in range(iter_max_passes)`
    # re-runs a full background pass (incl. an inner SNIP call) each
    # iteration -- the same unbounded-loop shape as smooth_passes, just
    # heavier per iteration (measured ~1s/1000 passes on n=5000 noisy data).
    # 1_000 is >300x the default.
    iter_max_passes: int = Field(3, ge=0, le=1_000)
    iter_sigma: float = 3.0


class ALSRequest(LeanBaseline, YSource):
    lam: float = 1e6
    p: float = 0.01
    max_iter: int = 20
    tol: float = 1e-6


class RollingBallRequest(LeanBaseline, YSource):
    radius: int = 100
    smooth: int = -1


class ModPolyRequest(LeanBaseline, YSource):
    order: int = 5
    max_iter: int = 100
    tol: float = 1e-6


class RegionBackgroundRequest(LeanBaseline, XYSource):
    x_min: float
    x_max: float
    y_min: float | None = None
    y_max: float | None = None
    order: int = 1


class AnchorRequest(LeanBaseline, XYSource):
    anchors: list[list[float]]  # (x, y) pairs picked on the plot
    method: str = "pchip"


class ShirleyRequest(LeanBaseline, XYSource):
    max_iter: int = 50
    tol: float = 1e-6
    edge_average: int = 1


class XrdLowAngleRequest(LeanBaseline, XYSource):
    include_x2: bool = True
    max_iter: int = 100
    tol: float = 1e-6


@router.post("/estimate")
def estimate(req: EstimateRequest, response: Response) -> dict[str, Any]:
    """SNIP / polynomial background, optionally peak-masked and refined."""
    x, y = source_xy(req, response)
    bg = call_calc(estimate_background,
        x,
        y,
        method=req.method,
        max_window_deg=req.max_window_deg,
        smooth_passes=req.smooth_passes,
        poly_degree=req.poly_degree,
        iterative=req.iterative,
        iter_max_passes=req.iter_max_passes,
        iter_sigma=req.iter_sigma,
    )
    return _baseline_body(bg, req)


@router.post("/als")
def als(req: ALSRequest, response: Response) -> dict[str, Any]:
    """Asymmetric least-squares (Eilers/Whittaker) baseline."""
    y = source_y(req, response)
    try:
        bg = baseline_als(
            np.asarray(y, dtype=float),
            lam=req.lam,
            p=req.p,
            max_iter=req.max_iter,
            tol=req.tol,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _baseline_body(bg, req)


@router.post("/rollingball")
def rollingball(req: RollingBallRequest, response: Response) -> dict[str, Any]:
    """Rolling-ball (grayscale morphological opening) baseline."""
    y = source_y(req, response)
    bg, info = call_calc(baseline_rolling_ball, y, radius=req.radius, smooth=req.smooth)
    return _baseline_body(bg, req, {"info": to_jsonable(info)})


@router.post("/modpoly")
def modpoly(req: ModPolyRequest, response: Response) -> dict[str, Any]:
    """Modified-polynomial (Lieber) baseline."""
    y = source_y(req, response)
    bg, info = call_calc(baseline_modpoly,
        y, order=req.order, max_iter=req.max_iter, tol=req.tol
    )
    return _baseline_body(bg, req, {"info": to_jsonable(info)})


@router.post("/anchor")
def anchor(req: AnchorRequest, response: Response) -> dict[str, Any]:
    """Baseline through user-picked (x, y) anchors (GOTO #2); extrapolation
    clamps to the end anchors."""
    x, y = source_xy(req, response)
    bg = call_calc(anchor_baseline, x, y, req.anchors, method=req.method)
    return _baseline_body(bg, req)


@router.post("/shirley")
def shirley(req: ShirleyRequest, response: Response) -> dict[str, Any]:
    """Iterative Shirley step background (GOTO #3). Non-convergence is a 422
    (the calc raises ValueError), never a 500."""
    x, y = source_xy(req, response)
    bg, info = call_calc(shirley_background,
        x, y, max_iter=req.max_iter, tol=req.tol,
        edge_average=req.edge_average,
    )
    return _baseline_body(bg, req, {"info": to_jsonable(info)})


@router.post("/xrdlowangle")
def xrd_low_angle(req: XrdLowAngleRequest, response: Response) -> dict[str, Any]:
    """Hyperbolic (One_on_X) low-angle air-scatter background (GOTO #7a)."""
    x, y = source_xy(req, response)
    bg, info = call_calc(xrd_low_angle_background,
        x, y, include_x2=req.include_x2,
        max_iter=req.max_iter, tol=req.tol,
    )
    return _baseline_body(bg, req, {"info": to_jsonable(info)})


@router.post("/region")
def region(req: RegionBackgroundRequest, response: Response) -> dict[str, Any]:
    """Fit a polynomial background from a boxed x/y region (BosonPlotter
    "Fit BG from Box"); returns coeffs + the full-range background + region stats."""
    x, y = source_xy(req, response)
    result = call_calc(fit_region_background,
        x, y, req.x_min, req.x_max,
        y_min=req.y_min, y_max=req.y_max, order=req.order,
    )
    bg = result.pop("background")
    out: dict[str, Any] = to_jsonable(result)
    if req.return_baseline:
        out["background"] = jsonify(bg)
        return out
    # Lean: the polynomial is the stored baseline, shown as ``baselineDisplay``.
    return _baseline_body(bg, req, out)
