"""Thin baseline routes: estimate a slowly-varying background under a signal.

Wraps ``calc.baseline`` + ``calc.backgrounds``. ALS / rolling-ball / modpoly
operate on ``y`` alone; ``estimate`` (SNIP / polynomial), Shirley, the anchor
baseline and the XRD low-angle model need ``x`` too. Methods with iteration
state also return an ``info`` dict (chosen window / iteration count / coeffs).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
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
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._payload import jsonify, to_jsonable

router = APIRouter(prefix="/api/baseline", tags=["baseline"])


class EstimateRequest(BaseModel):
    x: list[float]
    y: list[float]
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


class ALSRequest(BaseModel):
    y: list[float]
    lam: float = 1e6
    p: float = 0.01
    max_iter: int = 20
    tol: float = 1e-6


class RollingBallRequest(BaseModel):
    y: list[float]
    radius: int = 100
    smooth: int = -1


class ModPolyRequest(BaseModel):
    y: list[float]
    order: int = 5
    max_iter: int = 100
    tol: float = 1e-6


class RegionBackgroundRequest(BaseModel):
    x: list[float]
    y: list[float]
    x_min: float
    x_max: float
    y_min: float | None = None
    y_max: float | None = None
    order: int = 1


class AnchorRequest(BaseModel):
    x: list[float]
    y: list[float]
    anchors: list[list[float]]  # (x, y) pairs picked on the plot
    method: str = "pchip"


class ShirleyRequest(BaseModel):
    x: list[float]
    y: list[float]
    max_iter: int = 50
    tol: float = 1e-6
    edge_average: int = 1


class XrdLowAngleRequest(BaseModel):
    x: list[float]
    y: list[float]
    include_x2: bool = True
    max_iter: int = 100
    tol: float = 1e-6


@router.post("/estimate")
def estimate(req: EstimateRequest) -> dict[str, Any]:
    """SNIP / polynomial background, optionally peak-masked and refined."""
    bg = call_calc(estimate_background,
        req.x,
        req.y,
        method=req.method,
        max_window_deg=req.max_window_deg,
        smooth_passes=req.smooth_passes,
        poly_degree=req.poly_degree,
        iterative=req.iterative,
        iter_max_passes=req.iter_max_passes,
        iter_sigma=req.iter_sigma,
    )
    return {"baseline": jsonify(bg)}


@router.post("/als")
def als(req: ALSRequest) -> dict[str, Any]:
    """Asymmetric least-squares (Eilers/Whittaker) baseline."""
    try:
        bg = baseline_als(
            np.asarray(req.y, dtype=float),
            lam=req.lam,
            p=req.p,
            max_iter=req.max_iter,
            tol=req.tol,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"baseline": jsonify(bg)}


@router.post("/rollingball")
def rollingball(req: RollingBallRequest) -> dict[str, Any]:
    """Rolling-ball (grayscale morphological opening) baseline."""
    bg, info = call_calc(baseline_rolling_ball, req.y, radius=req.radius, smooth=req.smooth)
    return {"baseline": jsonify(bg), "info": to_jsonable(info)}


@router.post("/modpoly")
def modpoly(req: ModPolyRequest) -> dict[str, Any]:
    """Modified-polynomial (Lieber) baseline."""
    bg, info = call_calc(baseline_modpoly,
        req.y, order=req.order, max_iter=req.max_iter, tol=req.tol
    )
    return {"baseline": jsonify(bg), "info": to_jsonable(info)}


@router.post("/anchor")
def anchor(req: AnchorRequest) -> dict[str, Any]:
    """Baseline through user-picked (x, y) anchors (GOTO #2); extrapolation
    clamps to the end anchors."""
    bg = call_calc(anchor_baseline, req.x, req.y, req.anchors, method=req.method)
    return {"baseline": jsonify(bg)}


@router.post("/shirley")
def shirley(req: ShirleyRequest) -> dict[str, Any]:
    """Iterative Shirley step background (GOTO #3). Non-convergence is a 422
    (the calc raises ValueError), never a 500."""
    bg, info = call_calc(shirley_background,
        req.x, req.y, max_iter=req.max_iter, tol=req.tol,
        edge_average=req.edge_average,
    )
    return {"baseline": jsonify(bg), "info": to_jsonable(info)}


@router.post("/xrdlowangle")
def xrd_low_angle(req: XrdLowAngleRequest) -> dict[str, Any]:
    """Hyperbolic (One_on_X) low-angle air-scatter background (GOTO #7a)."""
    bg, info = call_calc(xrd_low_angle_background,
        req.x, req.y, include_x2=req.include_x2,
        max_iter=req.max_iter, tol=req.tol,
    )
    return {"baseline": jsonify(bg), "info": to_jsonable(info)}


@router.post("/region")
def region(req: RegionBackgroundRequest) -> dict[str, Any]:
    """Fit a polynomial background from a boxed x/y region (BosonPlotter
    "Fit BG from Box"); returns coeffs + the full-range background + region stats."""
    result = call_calc(fit_region_background,
        req.x, req.y, req.x_min, req.x_max,
        y_min=req.y_min, y_max=req.y_max, order=req.order,
    )
    bg = result.pop("background")
    out: dict[str, Any] = to_jsonable(result)
    out["background"] = jsonify(bg)
    return out
