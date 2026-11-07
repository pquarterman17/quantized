"""Thin crystallography route. Wraps ``calc.crystallography`` (pure formulas).

Computes interplanar d-spacing from lattice parameters + Miller indices, atomic
bond angles from fractional coordinates, unit-cell volume + theoretical
density (from a chemical formula + Z), the allowed-reflection table, atomic
number density, and the epitaxial-film strain helpers (tetragonal distortion,
Poisson coupling — ``calc.epitaxial_strain``); the math lives in calc, this
only validates + serializes.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.crystallography import (
    atomic_density,
    bond_angle,
    cell_volume,
    d_spacing,
    interplanar_angle,
    plane_spacings,
    theoretical_density,
)
from quantized.calc.epitaxial_strain import strain_from_poisson, tetragonal_distortion
from quantized.calc.formula import formula_mass
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/crystallography", tags=["crystallography"])


class DSpacingRequest(BaseModel):
    system: str
    a: float
    b: float = 0.0
    c: float = 0.0
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    h: int
    k: int
    l: int  # noqa: E741 — Miller index, the conventional name
    i: int | None = None  # optional 4-index Miller-Bravais form (hexagonal only)


@router.post("/dspacing")
def dspacing(req: DSpacingRequest) -> dict[str, Any]:
    """Interplanar d-spacing for (h,k,l) — or (h,k,i,l) for hexagonal — in the
    given crystal system."""
    return call_calc(d_spacing,
        req.system,
        req.a,
        req.b,
        req.c,
        req.h,
        req.k,
        req.l,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
        i=req.i,
    )


class InterplanarAngleRequest(BaseModel):
    system: str
    a: float
    b: float = 0.0
    c: float = 0.0
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    h1: int
    k1: int
    l1: int  # noqa: E741 — Miller index, the conventional name
    h2: int
    k2: int
    l2: int  # noqa: E741 — Miller index, the conventional name


@router.post("/angle")
def angle(req: InterplanarAngleRequest) -> dict[str, Any]:
    """Angle between two lattice planes (h1k1l1) and (h2k2l2), for any of the
    seven crystal systems, via the reciprocal metric tensor."""
    return call_calc(interplanar_angle,
        req.system,
        req.a,
        req.b,
        req.c,
        req.h1,
        req.k1,
        req.l1,
        req.h2,
        req.k2,
        req.l2,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
    )


class BondAngleRequest(BaseModel):
    a: float
    b: float
    c: float
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    atom1: tuple[float, float, float]
    vertex: tuple[float, float, float]
    atom3: tuple[float, float, float]
    minimum_image: bool = True


@router.post("/bond-angle")
def atomic_bond_angle(req: BondAngleRequest) -> dict[str, Any]:
    """Angle atom1-vertex-atom3 from fractional unit-cell coordinates."""
    return call_calc(
        bond_angle,
        req.a,
        req.b,
        req.c,
        req.alpha,
        req.beta,
        req.gamma,
        req.atom1,
        req.vertex,
        req.atom3,
        minimum_image=req.minimum_image,
    )


class CellRequest(BaseModel):
    a: float
    b: float = 0.0  # ≤ 0 → defaults to a (cubic / rhombohedral)
    c: float = 0.0  # ≤ 0 → defaults to a
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    formula: str = ""  # optional — enables molar mass + theoretical density
    z: int = 1  # formula units per cell


@router.post("/cell")
def cell(req: CellRequest) -> dict[str, Any]:
    """Unit-cell volume (Å³) and, when a formula is given, molar mass + density."""
    try:
        a = req.a
        b = req.b if req.b > 0 else a
        c = req.c if req.c > 0 else a
        volume = cell_volume(a, b, c, req.alpha, req.beta, req.gamma)
        out: dict[str, Any] = {"volume": volume}
        if req.formula.strip():
            mass = formula_mass(req.formula)
            out["molar_mass"] = mass
            out["density"] = theoretical_density(mass, req.z, volume)
        return out
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class PlaneSpacingsRequest(BaseModel):
    a: float
    b: float | None = None  # None -> a
    c: float | None = None  # None -> a
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    # MATLAB's card limits Max hkl to 1-10; the enumeration is (2n+1)^3 planes.
    max_hkl: int = Field(default=5, ge=1, le=10)
    wavelength: float = 1.5406  # Å
    centering: Literal["P", "F", "I", "A", "B", "C", "R"] = "P"


@router.post("/plane-spacings")
def plane_spacing_table(req: PlaneSpacingsRequest) -> dict[str, Any]:
    """Allowed (hkl) reflections with d, 2θ and multiplicity (``planeSpacings``).

    Unreachable reflections (λ/2d > 1) carry a ``null`` 2θ."""
    result = call_calc(
        plane_spacings,
        req.a,
        b=req.b,
        c=req.c,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
        max_hkl=req.max_hkl,
        lambda_=req.wavelength,
        centering=req.centering,
    )
    payload: dict[str, Any] = to_jsonable(result)
    return payload


class AtomicDensityRequest(BaseModel):
    a: float
    z: float  # atoms per unit cell
    b: float | None = None  # None -> a
    c: float | None = None  # None -> a
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0


@router.post("/atomic-density")
def atomic_number_density(req: AtomicDensityRequest) -> dict[str, Any]:
    """Atomic number density n = Z/V (atoms/cm³) from the cell and atoms per cell."""
    return call_calc(
        atomic_density,
        req.a,
        req.z,
        b=req.b,
        c=req.c,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
    )


class TetragonalDistortionRequest(BaseModel):
    a_relaxed: float  # Å
    c_measured: float  # Å
    c_relaxed: float | None = None  # Å; None -> a_relaxed (cubic bulk)


@router.post("/tetragonal-distortion")
def film_tetragonal_distortion(req: TetragonalDistortionRequest) -> dict[str, Any]:
    """Film c/a ratio and tetragonal distortion (c_meas − c_relaxed)/c_relaxed."""
    return call_calc(
        tetragonal_distortion, req.a_relaxed, req.c_measured, c_relaxed=req.c_relaxed
    )


class PoissonStrainRequest(BaseModel):
    eps_parallel: float  # dimensionless
    nu: float  # Poisson ratio


@router.post("/poisson-strain")
def poisson_strain(req: PoissonStrainRequest) -> dict[str, Any]:
    """Out-of-plane strain from biaxial in-plane strain: ε⊥ = −2ν/(1−ν)·ε∥."""
    return call_calc(strain_from_poisson, req.eps_parallel, req.nu)
