"""Thin routes for derived magnetic quantities from M(H) data: Maxwell
magnetic-entropy change, Arrott(-Noakes) analysis, approach to saturation."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.magnetic_critical import arrott_analysis
from quantized.calc.magnetic_entropy import magnetic_entropy_change
from quantized.calc.magnetic_saturation import approach_to_saturation
from quantized.calc.magnetic_series_compare import series_unit_plan
from quantized.routes._errors import call_calc as _call
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/magnetic", tags=["magnetic"])


class Isotherm(BaseModel):
    temperature: float = Field(allow_inf_nan=False, description="Kelvin")
    field: list[float]
    magnetization: list[float]


class _IsothermBase(BaseModel):
    isotherms: list[Isotherm]
    field_unit: str = "Oe"
    magnetization_unit: str = "emu/cm3"


class EntropyRequest(_IsothermBase):
    max_fields: list[float]
    n_grid: int = Field(default=201, ge=11, le=5001)


class ArrottRequest(_IsothermBase):
    window: tuple[float, float]
    beta: float = Field(default=0.5, allow_inf_nan=False)
    gamma: float = Field(default=1.0, allow_inf_nan=False)


class SaturationRequest(BaseModel):
    field: list[float]
    magnetization: list[float]
    field_unit: str = "Oe"
    magnetization_unit: str = "emu/cm3"
    h_min: float = Field(allow_inf_nan=False)
    include_a: bool = True
    include_b: bool = True
    include_chi: bool = True
    symmetry: Literal["uniaxial", "cubic"] = "uniaxial"


class SeriesUnits(BaseModel):
    label: str = ""
    x_unit: str
    y_unit: str


class SeriesComparePlanRequest(BaseModel):
    series: list[SeriesUnits]
    axis: Literal["field", "temperature"]
    x_unit: str | None = None
    y_unit: str | None = None


@router.post("/series-compare-plan")
def series_compare_plan(req: SeriesComparePlanRequest) -> dict[str, Any]:
    """Per-series X / Y factors that put several M(T) or M(H) series in one unit."""
    result = _call(
        series_unit_plan,
        [s.model_dump() for s in req.series],
        axis=req.axis,
        x_unit=req.x_unit,
        y_unit=req.y_unit,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/entropy-change")
def entropy_change(req: EntropyRequest) -> dict[str, Any]:
    """Maxwell-relation magnetic entropy change dS_M(T) and RCP from isotherms."""
    result = _call(
        magnetic_entropy_change,
        [i.model_dump() for i in req.isotherms],
        field_unit=req.field_unit,
        magnetization_unit=req.magnetization_unit,
        max_fields=req.max_fields,
        n_grid=req.n_grid,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/arrott")
def arrott(req: ArrottRequest) -> dict[str, Any]:
    """Arrott / Arrott-Noakes lines per isotherm and the Tc intercept crossing."""
    result = _call(
        arrott_analysis,
        [i.model_dump() for i in req.isotherms],
        field_unit=req.field_unit,
        magnetization_unit=req.magnetization_unit,
        beta=req.beta,
        gamma=req.gamma,
        window=req.window,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/approach-to-saturation")
def approach(req: SaturationRequest) -> dict[str, Any]:
    """Law-of-approach-to-saturation fit: Ms, a, b, chi_hf (+ K1)."""
    result = _call(
        approach_to_saturation,
        req.field,
        req.magnetization,
        field_unit=req.field_unit,
        magnetization_unit=req.magnetization_unit,
        h_min=req.h_min,
        include_a=req.include_a,
        include_b=req.include_b,
        include_chi=req.include_chi,
        symmetry=req.symmetry,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]
