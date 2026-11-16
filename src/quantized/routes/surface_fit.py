"""Thin surface-fit routes: z = f(x, y) on scattered / gridded XYZ data.

Wraps ``calc.surface_fit`` (bounded Nelder-Mead, MATLAB ``surfaceFit`` port) and
the ``calc.surface_models`` catalog. Parameter inference (t, p, confidence
limits) reuses ``calc.fit_report.parameter_inference`` so the numbers match the
Curve Fit results view.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.fit_report import parameter_inference
from quantized.calc.surface_fit import surface_auto_guess, surface_fit
from quantized.calc.surface_models import get_surface_model, surface_models
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/surface-fit", tags=["surface-fit"])

_MAX_POINTS = 250_000


class SurfaceXYZ(BaseModel):
    x: list[float]
    y: list[float]
    z: list[float]
    model: str


class SurfaceFitRequest(SurfaceXYZ):
    p0: list[float] | None = None
    # null entry = unbounded on that side
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    level: float = Field(default=0.95, gt=0.0, lt=1.0)
    max_iter: int = Field(default=10000, ge=1, le=200_000)


def _xyz(req: SurfaceXYZ) -> tuple[Any, Any, Any]:
    x, y, z = (np.asarray(v, dtype=float) for v in (req.x, req.y, req.z))
    if not (x.size == y.size == z.size):
        raise HTTPException(status_code=422, detail="x, y and z must have the same length")
    if x.size > _MAX_POINTS:
        raise HTTPException(status_code=422, detail=f"too many points ({x.size} > {_MAX_POINTS})")
    ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    return x[ok], y[ok], z[ok]


def _bound(vals: list[float | None] | None, fill: float) -> list[float] | None:
    return None if vals is None else [fill if v is None else v for v in vals]


@router.get("/models")
def models() -> list[dict[str, Any]]:
    """The surface model catalog (name, parameter names, formula text)."""
    return [
        {"name": m.name, "param_names": list(m.param_names), "description": m.description}
        for m in surface_models()
    ]


@router.post("/guess")
def guess(req: SurfaceXYZ) -> dict[str, Any]:
    """Heuristic starting parameters for ``model`` on this data."""
    x, y, z = _xyz(req)
    try:
        mdl = get_surface_model(req.model)
        if x.size < 2:
            raise ValueError("need at least 2 finite points")
        return {
            "param_names": list(mdl.param_names),
            "p0": to_jsonable(surface_auto_guess(mdl, x, y, z)),
        }
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fit")
def fit(req: SurfaceFitRequest) -> dict[str, Any]:
    """Fit ``model`` to (x, y, z); non-finite triples are dropped."""
    x, y, z = _xyz(req)
    try:
        mdl = get_surface_model(req.model)
        if x.size < mdl.n_params:
            raise ValueError(
                f"{mdl.name} has {mdl.n_params} parameters but only {x.size} finite points"
            )
        res = surface_fit(
            x,
            y,
            z,
            mdl,
            p0=req.p0,
            lower=_bound(req.lower, -np.inf),
            upper=_bound(req.upper, np.inf),
            max_iter=req.max_iter,
            linear=True,
        )
        dof = int(res["n_points"] - res["n_free"])
        inference = parameter_inference(res["params"], res["errors"], dof, req.level)
        out = {
            **res,
            "dof": dof,
            "level": req.level,
            "inference": inference,
        }
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
