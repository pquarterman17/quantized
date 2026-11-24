"""Polar map maths: pole-figure projections and gridding of I(chi, phi).

GAP_AUDIT_9 G2 (Origin "polar contour / polar heatmap"; a pole figure is the
same plot, intensity over tilt chi (radial) and azimuth phi (angular)).

Projection of the tilt angle ``chi`` (0 = pole at the centre, 90 deg = rim)
onto the unit disk, both normalised so ``chi = 90 deg`` lands on ``r = 1``:

* equal-area (Schmidt / Lambert azimuthal): ``r = sqrt(2) * sin(chi / 2)``.
  A projected area is a constant (1/2) multiple of the spherical area it
  covers, so intensity density is not distorted -- the usual choice for
  texture work;
* stereographic (Wulff): ``r = tan(chi / 2)``; conformal (angles preserved).

OWNER DECISION (2026-11-24, GAP_AUDIT_9 D4): the pole-figure default
projection is **equal-area (Schmidt)**; stereographic (Wulff) is offered as
an option. Formulas: Kocks, Tome & Wenk, *Texture and Anisotropy* (CUP 1998)
ch. 2; Snyder, *Map Projections: A Working Manual* (USGS PP 1395, 1987)
(Lambert azimuthal equal-area, eq. 24-xx at the unit sphere, and the
stereographic projection). Upper hemisphere only (chi 0-90 deg): a pole
figure's tilt never exceeds 90 deg, and a point beyond it is refused rather
than folded.

Gridding: scattered (chi, phi, I) points are placed on the projected disk
(x = r cos phi, y = r sin phi), de-duplicated (the centre, and phi = 0 vs
360, are the same place), and interpolated linearly on their Delaunay
triangulation onto a regular (r, phi) grid. Cells outside the convex hull of
the data are NaN (never extrapolated).

Pure layer: ndarray in, ndarray out; no fastapi/pydantic, no matplotlib.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import LinearNDInterpolator

__all__ = [
    "CHI_MAX_DEG",
    "DEFAULT_PROJECTION",
    "MIN_POINTS",
    "PROJECTIONS",
    "PolarGrid",
    "grid_polar_map",
    "project_radius",
    "projected_xy",
]

PROJECTIONS = ("equal_area", "stereographic")
# Owner decision 2026-11-24 (D4): equal-area (Schmidt) is the default.
DEFAULT_PROJECTION = "equal_area"
CHI_MAX_DEG = 90.0
# Below this many distinct finite points a Delaunay grid is not meaningful.
MIN_POINTS = 10
# chi values a hair outside 0-90 (instrument rounding, e.g. 90.0000001) pass.
_CHI_TOL = 1e-6
_MAX_CELLS = 400 * 720


def project_radius(chi_deg: ArrayLike, projection: str = DEFAULT_PROJECTION) -> NDArray[np.float64]:
    """Radius on the unit disk for tilt ``chi_deg`` (0 = centre, 90 = rim).

    Raises ``ValueError`` for an unknown projection. Range checking is
    :func:`grid_polar_map`'s job; this is the bare formula (chi = 90 -> 1).
    """
    chi = np.deg2rad(np.asarray(chi_deg, dtype=float))
    if projection == "equal_area":
        # sqrt(2) * sin(chi/2) is already 1 at chi = 90 deg (sin 45 = 1/sqrt 2).
        return np.asarray(np.sqrt(2.0) * np.sin(chi / 2.0), dtype=np.float64)
    if projection == "stereographic":
        return np.asarray(np.tan(chi / 2.0), dtype=np.float64)  # tan 45 = 1
    raise ValueError(f"projection must be one of {PROJECTIONS}, got {projection!r}")


def projected_xy(
    chi_deg: ArrayLike, phi_deg: ArrayLike, projection: str = DEFAULT_PROJECTION
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Unit-disk cartesian position of (chi, phi); phi counter-clockwise from +x."""
    r = project_radius(chi_deg, projection)
    phi = np.deg2rad(np.asarray(phi_deg, dtype=float))
    return r * np.cos(phi), r * np.sin(phi)


@dataclass(frozen=True, slots=True)
class PolarGrid:
    """A regular polar grid of interpolated intensity.

    ``r`` are the cell-centre radii (unit disk, ``n_r``), ``phi_deg`` the cell
    centre azimuths (``n_phi``), ``z`` has shape ``(n_r, n_phi)`` with NaN
    outside the data's hull.
    """

    r: NDArray[np.float64]
    phi_deg: NDArray[np.float64]
    z: NDArray[np.float64]
    n_points: int
    projection: str


def _check_inputs(
    chi: NDArray[np.float64], phi: NDArray[np.float64], z: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    if not (chi.shape == phi.shape == z.shape and chi.ndim == 1):
        raise ValueError("chi, phi and intensity must be 1-D columns of equal length")
    keep = np.isfinite(chi) & np.isfinite(phi) & np.isfinite(z)
    chi, phi, z = chi[keep], phi[keep], z[keep]
    if chi.size < MIN_POINTS:
        raise ValueError(
            f"a polar map needs at least {MIN_POINTS} finite (chi, phi, intensity) points "
            f"to grid; got {chi.size}"
        )
    if chi.min() < -_CHI_TOL or chi.max() > CHI_MAX_DEG + _CHI_TOL:
        raise ValueError(
            "chi (tilt) must lie in 0-90 degrees for a pole figure; the data spans "
            f"{chi.min():g} to {chi.max():g}. Pick the tilt column as chi, or "
            "fold/convert the data first."
        )
    return np.clip(chi, 0.0, CHI_MAX_DEG), phi, z


def _dedupe(
    x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Merge coincident projected points (mean intensity): every phi at
    chi = 0 is one place, and phi = 0 / 360 are the same ray."""
    key = np.column_stack([np.round(x, 9), np.round(y, 9)])
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    n = int(inv.max()) + 1
    cnt = np.bincount(inv, minlength=n).astype(float)
    return (
        np.bincount(inv, weights=x, minlength=n) / cnt,
        np.bincount(inv, weights=y, minlength=n) / cnt,
        np.bincount(inv, weights=z, minlength=n) / cnt,
    )


def grid_polar_map(
    chi_deg: ArrayLike,
    phi_deg: ArrayLike,
    intensity: ArrayLike,
    *,
    projection: str = DEFAULT_PROJECTION,
    n_r: int = 100,
    n_phi: int = 360,
) -> PolarGrid:
    """Grid scattered (chi, phi, I) onto a regular polar grid.

    Raises ``ValueError`` when chi is outside 0-90 degrees, when fewer than
    :data:`MIN_POINTS` finite points remain, when the points are degenerate
    (collinear, e.g. one phi only, so there is no 2-D hull), or on an
    unusable grid size / projection.
    """
    if projection not in PROJECTIONS:
        raise ValueError(f"projection must be one of {PROJECTIONS}, got {projection!r}")
    if not (8 <= n_r and 24 <= n_phi) or n_r * n_phi > _MAX_CELLS:
        raise ValueError(f"grid must be at least 8 x 24 and at most {_MAX_CELLS} cells")
    chi, phi, z = _check_inputs(
        np.asarray(chi_deg, dtype=float),
        np.asarray(phi_deg, dtype=float),
        np.asarray(intensity, dtype=float),
    )
    x, y = projected_xy(chi, phi, projection)
    x, y, z = _dedupe(x, y, z)
    if x.size < MIN_POINTS:
        raise ValueError(
            f"only {x.size} distinct positions after merging duplicates; need {MIN_POINTS}"
        )
    try:
        interp = LinearNDInterpolator(np.column_stack([x, y]), z)
    except Exception as exc:  # scipy's QhullError: collinear / too few dimensions
        raise ValueError(
            "the (chi, phi) points do not span a 2-D area (all on one line?); cannot grid"
        ) from exc
    r = np.asarray((np.arange(n_r) + 0.5) / n_r, dtype=np.float64)
    phi_c = np.asarray((np.arange(n_phi) + 0.5) * (360.0 / n_phi), dtype=np.float64)
    rr, pp = np.meshgrid(r, np.deg2rad(phi_c), indexing="ij")
    zg = np.asarray(interp(rr * np.cos(pp), rr * np.sin(pp)), dtype=np.float64)
    return PolarGrid(r=r, phi_deg=phi_c, z=zg, n_points=int(x.size), projection=projection)
