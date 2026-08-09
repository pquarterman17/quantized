"""Thin RSM route: substrate/film reciprocal-space peaks -> strain + relaxation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from quantized.calc.boxcut import box_cut, box_stats
from quantized.calc.linecut import cut_segment, line_cut, projection
from quantized.calc.rsm import rsm_strain
from quantized.calc.rsm_analyze import rsm_analyze, rsm_grids_from_datastruct
from quantized.calc.sectorcut import chi_profile, sector_profile
from quantized.datastruct import DataStruct
from quantized.routes._payload import datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/rsm", tags=["rsm"])


class StrainRequest(BaseModel):
    """Reciprocal-space peak centres ``(Qx, Qz)`` in Ang^-1."""

    q_sub: tuple[float, float]
    q_film: tuple[float, float]
    bulk: tuple[float, float] | None = None


@router.post("/strain")
def strain(req: StrainRequest) -> dict[str, Any]:
    """In-plane / out-of-plane strain + relaxation from an RSM peak pair."""
    try:
        result = rsm_strain(req.q_sub, req.q_film, bulk=req.bulk)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # NaN (symmetric reflection / no bulk) -> null for valid wire JSON.
    return to_jsonable(result)  # type: ignore[no-any-return]


class AnalyzeRequest(BaseModel):
    """A scattered 2D RSM dataset (from the XRDML 2D parser) + detection options."""

    dataset: dict[str, Any]
    n_peaks: int = Field(default=2, ge=1, le=20)
    threshold: float = Field(default=0.01, ge=0.0)
    smooth_sigma: float = Field(default=1.5, gt=0.0)
    min_separation: int = Field(default=4, ge=1)
    fit_window: int = Field(default=6, ge=1)
    fit_model: str = "2D Gaussian"


@router.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    """Extract + fit peaks from a 2D RSM dataset (centres/FWHM in angle + Q-space)."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        grids = rsm_grids_from_datastruct(ds)
        result = rsm_analyze(
            grids["intensity"],
            grids["axis1"],
            grids["axis2"],
            qx=grids["qx"],
            qz=grids["qz"],
            n_peaks=req.n_peaks,
            threshold=req.threshold,
            smooth_sigma=req.smooth_sigma,
            min_separation=req.min_separation,
            fit_window=req.fit_window,
            fit_model=req.fit_model,
            intensity_unit=grids["intensity_unit"],
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]


class LineCutRequest(BaseModel):
    """Fixed-axis cut through a 2-D map dataset (H/V, angular or Q space)."""

    dataset: dict[str, Any]
    direction: str  # "h" | "v"
    value: float
    space: str = "angular"
    width: float = Field(default=0.0, ge=0.0)


@router.post("/linecut")
def linecut(req: LineCutRequest) -> dict[str, Any]:
    """H/V line cut -> a 1-D DataStruct (width>0 averages a swath)."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        out = line_cut(
            ds, direction=req.direction, value=req.value, space=req.space, width=req.width
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class CutSegmentRequest(BaseModel):
    """Arbitrary straight cut p0 -> p1 through the scattered 2-D cloud."""

    dataset: dict[str, Any]
    p0: tuple[float, float]
    p1: tuple[float, float]
    n: int = Field(default=200, ge=2, le=1_000_000)
    width: float = Field(default=0.0, ge=0.0)
    space: str = "angular"


@router.post("/cut-segment")
def cut_segment_route(req: CutSegmentRequest) -> dict[str, Any]:
    """Arbitrary-angle segment cut -> a distance-parametrized 1-D DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        out = cut_segment(ds, p0=req.p0, p1=req.p1, n=req.n, width=req.width, space=req.space)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class ProjectionRequest(BaseModel):
    """Integrate the whole map onto one axis."""

    dataset: dict[str, Any]
    axis: str = "pixels"  # "pixels" (I vs 2theta) | "frames" (I vs omega)
    space: str = "angular"


@router.post("/projection")
def projection_route(req: ProjectionRequest) -> dict[str, Any]:
    """Full-map integrated profile -> a 1-D DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        out = projection(ds, axis=req.axis, space=req.space)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class _SectorParams(BaseModel):
    """Shared azimuthal-sector fields for /sector and /chi-profile.

    Users think in one of two idioms ("give me phi in [min, max)" or "the
    [002] direction +-5 deg"), so both are accepted -- EITHER
    ``phi_min``/``phi_max`` OR ``phi_center``/``phi_halfwidth``, never
    both, normalized here to the canonical min/max calc.sectorcut expects.
    Neither given -> full circle (calc's own default). Range/mode
    validation (q_max>q_min>=0, n_bins>=2, mode) stays in calc -- routes
    only resolve which parameterization was used.
    """

    q_min: float
    q_max: float
    phi_min: float | None = None
    phi_max: float | None = None
    phi_center: float | None = None
    phi_halfwidth: float | None = None
    mode: str = "sum"

    @model_validator(mode="after")
    def _normalize_sector(self) -> _SectorParams:
        minmax_given = self.phi_min is not None or self.phi_max is not None
        center_given = self.phi_center is not None or self.phi_halfwidth is not None
        if minmax_given and center_given:
            raise ValueError(
                "specify EITHER phi_min/phi_max OR phi_center/phi_halfwidth, not both"
            )
        if center_given:
            if self.phi_center is None or self.phi_halfwidth is None:
                raise ValueError("phi_center and phi_halfwidth must both be given")
            self.phi_min = self.phi_center - self.phi_halfwidth
            self.phi_max = self.phi_center + self.phi_halfwidth
        elif not minmax_given:
            self.phi_min = -180.0
            self.phi_max = 180.0
        elif self.phi_min is None or self.phi_max is None:
            raise ValueError("phi_min and phi_max must both be given")
        return self

    def resolved_sector(self) -> tuple[float, float]:
        """``(phi_min, phi_max)`` after ``_normalize_sector`` has run (never None)."""
        assert self.phi_min is not None and self.phi_max is not None
        return self.phi_min, self.phi_max


class SectorRequest(_SectorParams):
    """Radial |Q| profile within an azimuthal sector -> see ``sector_profile``."""

    dataset: dict[str, Any]
    n_bins: int = Field(default=100, ge=2)


@router.post("/sector")
def sector(req: SectorRequest) -> dict[str, Any]:
    """Radial (|Q|) profile within an azimuthal sector -> a 2-column DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        phi_min, phi_max = req.resolved_sector()
        out = sector_profile(
            ds,
            q_min=req.q_min,
            q_max=req.q_max,
            n_bins=req.n_bins,
            phi_min=phi_min,
            phi_max=phi_max,
            mode=req.mode,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class ChiProfileRequest(_SectorParams):
    """Azimuthal profile within a |Q| annulus -> see ``chi_profile``."""

    dataset: dict[str, Any]
    n_bins: int = Field(default=90, ge=2)
    mode: str = "mean"


@router.post("/chi-profile")
def chi_profile_route(req: ChiProfileRequest) -> dict[str, Any]:
    """Azimuthal ("chi") profile within a |Q| annulus -> a 2-column DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        phi_min, phi_max = req.resolved_sector()
        out = chi_profile(
            ds,
            q_min=req.q_min,
            q_max=req.q_max,
            n_bins=req.n_bins,
            phi_min=phi_min,
            phi_max=phi_max,
            mode=req.mode,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class BoxCutRequest(BaseModel):
    """Bounded rectangular ROI (or rotated cut-ruler) -> see ``boxcut.box_cut``."""

    dataset: dict[str, Any]
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    space: str = "angular"
    collapse: str = "x"
    reduce: str = "sum"
    n_bins: int | None = Field(default=None, ge=2)
    angle: float = 0.0
    wrap: str | None = None


@router.post("/box")
def box(req: BoxCutRequest) -> dict[str, Any]:
    """Bounded box (or rotated-ruler) integration -> a 2-column DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        out = box_cut(
            ds,
            x_min=req.x_min,
            x_max=req.x_max,
            y_min=req.y_min,
            y_max=req.y_max,
            space=req.space,
            collapse=req.collapse,
            reduce=req.reduce,
            n_bins=req.n_bins,
            angle=req.angle,
            wrap=req.wrap,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)


class BoxStatsRequest(BaseModel):
    """Scalar summary over a rectangular ROI -> see ``boxcut.box_stats``."""

    dataset: dict[str, Any]
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    space: str = "angular"
    angle: float = 0.0
    wrap: str | None = None


@router.post("/box-stats")
def box_stats_route(req: BoxStatsRequest) -> dict[str, Any]:
    """Scalar box summary (n points, integrated intensity, centroid, peak) -> a dict."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        result = box_stats(
            ds,
            x_min=req.x_min,
            x_max=req.x_max,
            y_min=req.y_min,
            y_max=req.y_max,
            space=req.space,
            angle=req.angle,
            wrap=req.wrap,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]
