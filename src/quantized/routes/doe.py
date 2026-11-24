"""Thin routes: design of experiments (GAP_AUDIT_9 J16).

``/api/doe/generate`` builds a design worksheet (pure
:mod:`quantized.calc.doe` + :mod:`quantized.calc.doe_sheet`);
``/api/doe/effects`` computes the contrast effects, Lenth PSE and half-normal
quantities of a two-level design. Both run inline (microseconds to
milliseconds). Analysis of the fitted model is Fit Model (``routes/stats_model``).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc import doe
from quantized.calc.doe_effects import effects
from quantized.calc.doe_sheet import FactorSetting, build_worksheet
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/doe", tags=["doe"])

DesignType = Literal[
    "full_factorial", "fractional_factorial", "plackett_burman", "ccd", "box_behnken"
]


class DoeFactor(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    low: float = -1.0
    high: float = 1.0
    unit: str = Field("", max_length=32)


class DoeGenerateRequest(BaseModel):
    design: DesignType
    #: number of factors; ``factors`` (names, ranges) must have this many entries.
    factors: list[DoeFactor] = Field(min_length=2, max_length=doe.MAX_FACTORS)
    response_name: str = Field("Response", min_length=1, max_length=64)
    #: fractional_factorial: number of generators p (2^(k-p) runs).
    p: int | None = None
    #: plackett_burman: 12, 20 or 24.
    runs: int | None = None
    replicates: int = 1
    #: ``null`` = the published default (NIST Table 3.28 for RSM, 0 for 2-level designs).
    center_points: int | None = None
    #: ccd: "rotatable", "face_centered", "orthogonal" or a number.
    alpha: str | float = "rotatable"
    ccd_fractional: bool = False
    ccd_inscribed: bool = False
    randomize: bool = False
    seed: int | None = None


def _make(req: DoeGenerateRequest) -> doe.Design:
    k = len(req.factors)
    cp = req.center_points
    if req.design == "full_factorial":
        return doe.full_factorial(k, req.replicates, cp or 0)
    if req.design == "fractional_factorial":
        if req.p is None:
            raise ValueError("fractional_factorial needs p (the number of generators)")
        return doe.fractional_factorial(k, req.p, req.replicates, cp or 0)
    if req.design == "plackett_burman":
        if req.runs is None:
            raise ValueError("plackett_burman needs runs (12, 20 or 24)")
        return doe.plackett_burman(req.runs, k, req.replicates, cp or 0)
    if req.design == "ccd":
        return doe.central_composite(k, req.alpha, cp, req.ccd_fractional, req.ccd_inscribed)
    return doe.box_behnken(k, cp)


@router.post("/generate")
def generate_route(req: DoeGenerateRequest) -> dict[str, Any]:
    """A design worksheet (``dataset``) plus the alias structure and resolution."""
    try:
        design = _make(req)
        ds = build_worksheet(
            design,
            [FactorSetting(f.name, f.low, f.high, f.unit) for f in req.factors],
            req.response_name,
            req.randomize,
            req.seed,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"dataset": datastruct_payload(ds), "doe": ds.metadata["doe"]}


@router.get("/fractions/{k}")
def fractions_route(k: int) -> dict[str, Any]:
    """The published 2^(k-p) fractions of ``k`` factors (runs, resolution, generators)."""
    return {
        "k": k,
        "fractions": doe.available_fractions(k),
        "center_points": {
            "ccd": doe.default_ccd_center_points(k, False),
            "ccd_fractional": doe.default_ccd_center_points(k, True),
            "box_behnken": doe.default_bb_center_points(k),
        },
    }


class DoeEffectsRequest(BaseModel):
    #: coded (+-1) factor columns by name.
    factor_columns: dict[str, list[float | None]]
    response: list[float | None]
    terms: list[list[str]]


@router.post("/effects")
def effects_route(req: DoeEffectsRequest) -> dict[str, Any]:
    """Contrast effects, Lenth PSE/ME/SME and half-normal quantiles."""
    try:
        return to_jsonable(effects(req.factor_columns, req.response, req.terms))  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
