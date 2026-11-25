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
from quantized.calc.doe_block import apply_blocking
from quantized.calc.doe_effects import effects
from quantized.calc.doe_optimal import OptFactor, candidates_from_rows, d_optimal
from quantized.calc.doe_sheet import FactorSetting, build_worksheet
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/doe", tags=["doe"])

DesignType = Literal[
    "full_factorial", "fractional_factorial", "plackett_burman", "ccd", "box_behnken", "d_optimal"
]


class DoeFactor(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    low: float = -1.0
    high: float = 1.0
    unit: str = Field("", max_length=32)
    #: d_optimal only: level names make the factor categorical (low/high unused).
    levels: list[str] = Field(default_factory=list, max_length=32)


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
    #: full/fractional factorial: number of blocks (1 = none, else 2, 4, 8, 16), and
    #: optionally the block generators as words ("ABC"); null = the standard choice.
    blocks: int = 1
    block_generators: list[str] | None = None
    #: d_optimal: model, run count, exchange method, optional candidate set in ACTUAL
    #: units (categorical = level names), grid levels per continuous factor,
    #: random starts and the optimiser's seed (distinct from the run-order ``seed``).
    model: Literal["main", "interaction", "quadratic"] = "interaction"
    n_runs: int | None = None
    method: Literal["coordinate", "fedorov"] = "coordinate"
    candidates: list[list[float | str]] | None = None
    grid_levels: int | None = None
    starts: int = 10
    opt_seed: int = 0


def _opt_factors(req: DoeGenerateRequest) -> list[OptFactor]:
    return [OptFactor(f.name, f.low, f.high, tuple(f.levels)) for f in req.factors]


def _make_optimal(req: DoeGenerateRequest) -> doe.Design:
    if req.n_runs is None:
        raise ValueError("d_optimal needs n_runs (the number of runs)")
    if req.replicates != 1 or req.center_points:
        raise ValueError(
            "d_optimal chooses its own runs: replicates and center points do not apply"
        )
    factors = _opt_factors(req)
    cand = candidates_from_rows(factors, req.candidates) if req.candidates is not None else None
    return d_optimal(
        factors, req.model, req.n_runs, req.method, cand, req.grid_levels, req.starts, req.opt_seed
    ).design


def _make(req: DoeGenerateRequest) -> doe.Design:
    design = _make_base(req)
    if req.blocks == 1:
        if req.block_generators:
            raise ValueError("block_generators were given but blocks is 1")
        return design
    if req.blocks not in (2, 4, 8, 16):
        raise ValueError("blocks must be 1, 2, 4, 8 or 16")
    return apply_blocking(design, req.blocks.bit_length() - 1, req.block_generators)


def _make_base(req: DoeGenerateRequest) -> doe.Design:
    k = len(req.factors)
    if req.design != "d_optimal" and any(f.levels for f in req.factors):
        raise ValueError("categorical factors (levels) are only offered for d_optimal designs")
    if req.design == "d_optimal":
        return _make_optimal(req)
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
            [FactorSetting(f.name, f.low, f.high, f.unit, tuple(f.levels)) for f in req.factors],
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
