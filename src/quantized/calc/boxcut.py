"""Cartesian (box) integration from 2-D RSM DataStructs (RSM_CUTS_PLAN item 3).

NEW -- the MATLAB reference has no box/ROI integration at all (see
``calc/sectorcut.py``'s module docstring for the polar family it DOES have).
:func:`box_cut` bins intensity within an axis-aligned (or rotated) rectangle
onto one of its two axes ("collapse" onto x or y); :func:`box_stats` reduces
the same rectangle to the paper numbers (integrated intensity, centroid,
peak) a user pastes straight into a figure caption -- a dict, not a
DataStruct, the same ``rsm_strain`` precedent (``calc/rsm.py``: a scalar
summary is a dict).

Two selection paths (Resolved decisions, RSM_CUTS_PLAN: "Box = exact on
angular grids, mask+bin in Q / scattered"):

- **Grid path** -- ``space="angular"`` on a dataset with ``metadata.map_shape``
  and no rotation/periodic axis (``angle=0``, ``wrap=None``): the angular
  grid is axis-aligned (rows are constant-<axis1>, columns are
  constant-2Theta -- the SAME fact ``linecut.line_cut`` exploits), so the box
  selects whole grid lines with a boolean mask -- EXACT, zero interpolation,
  using ``line_cut``'s own ``sel`` convention (``sel_y = mean(sec, axis=1)``,
  ``sel_x = mean(tt, axis=0)``).
- **Cloud path** -- everything else: ``space="q"`` always (Q grids are
  curvilinear -- a fixed "row" sweeps most of the map's Qz range, see
  ``linecut.py``'s FINDING-1 note; box's Q path must never take the grid
  shortcut for the same reason); no ``map_shape``; a rotated ROI
  (``angle != 0``); or a periodic-axis ROI (``wrap`` set). Masks the
  scattered ``(x, y, Intensity)`` columns from
  ``_rsm_grid.scatter_columns`` and bins the "collapse" coordinate with
  ``scipy.stats.binned_statistic``. ``angle != 0`` rotates the POINTS about
  the ROI centre by ``-angle`` before masking -- the cut-ruler backend
  (Resolved decisions rev 2): a box rotated by ``angle`` in the original
  frame is an axis-aligned box in a frame rotated by ``-angle``, so rotating
  the data (not the box) lets the rest of the cloud path apply verbatim.
  ``wrap="x"|"y"`` applies :func:`quantized.calc._rsm_grid.wrap_mask`'s
  mod-360 rebase to that axis's bounds instead of a plain range mask -- the
  pole-figure periodic-axis branch (ii) of the polar-space rule (an
  azimuthal axis spanning the 0/360 seam). Rotation and periodic axes always
  use the cloud path, never the grid path.

UNCERTAINTY (same statement as ``sectorcut.py``, repeated here because
``box_cut`` is a separate entry point): the "N points" column is NOT a
sqrt(N) error bar. For SUMMED raw counts the Poisson uncertainty is
``sigma = sqrt(sum(I))``, computable from the Intensity column alone -- and
valid ONLY when the Intensity unit is raw counts, not cps (PANalytical XRDML
frequently reports counts-per-second; check ``ds.units``/``ds.metadata``
before treating ``sqrt(I)`` as meaningful -- for cps, scale by the counting
time first). "N points" exists for mean-normalization (the literal mean
divisor) and to flag under-sampled bins/lines (small N is unreliable) -- it
is not itself a standalone uncertainty. An empty bin/line reports 0 for
``reduce="sum"`` (matching ``sectorcut``'s empty-bin convention) and NaN for
``reduce="mean"``/``"max"`` (nothing to average or max over).

``box_stats``' ``centroid_x``/``centroid_y`` are intensity-weighted using the
RAW Intensity values as weights (not background-subtracted, not clipped) --
documented so a caller knows what "centroid" means here: the selected point
cloud's own mean, weighted by its own reported intensity.

Pure calc layer (ndarray/DataStruct in -> DataStruct/dict out); no
fastapi/pydantic imports.
"""

from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.stats import binned_statistic

from quantized.calc._rsm_grid import (
    SPACES,
    cut_result,
    full_grids,
    require_finite,
    scatter_columns,
    wrap_mask,
)
from quantized.datastruct import DataStruct

__all__ = ["box_cut", "box_stats"]

_COLLAPSE = ("x", "y")
_REDUCE = ("sum", "mean", "max")
_WRAP: tuple[str | None, ...] = (None, "x", "y")
_DEFAULT_N_BINS = 200


def _validate_space_wrap(space: str, wrap: str | None) -> None:
    if space not in SPACES:
        raise ValueError(f"space must be one of {SPACES}, got {space!r}")
    if wrap not in _WRAP:
        raise ValueError(f'wrap must be one of "x", "y", or None, got {wrap!r}')


def _validate_angle(angle: float) -> None:
    require_finite(angle=angle)


def _validate_bounds(
    x_min: float, x_max: float, y_min: float, y_max: float, wrap: str | None
) -> None:
    """Bounds must be ordered on any axis that is NOT wrapped -- a wrapped
    axis's ``min > max`` is the normal wrapping case (crossing the 0/360
    seam), the same freedom ``sector_profile``'s ``phi_min``/``phi_max``
    already has (e.g. ``phi_min=170, phi_max=-170``)."""
    require_finite(x_min=x_min, x_max=x_max, y_min=y_min, y_max=y_max)
    if wrap != "x" and x_max <= x_min:
        raise ValueError(f"require x_max > x_min, got x_min={x_min!r}, x_max={x_max!r}")
    if wrap != "y" and y_max <= y_min:
        raise ValueError(f"require y_max > y_min, got y_min={y_min!r}, y_max={y_max!r}")


def _rotate(
    xs: NDArray[np.float64],
    ys: NDArray[np.float64],
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    angle: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Rotate points by ``-angle`` degrees about the ROI's own centre.

    The cut-ruler backend: a box rotated by ``angle`` in the ORIGINAL frame
    is an axis-aligned box in a frame rotated by ``-angle``, so rotating the
    data (not the box) lets the rest of the cloud path run unmodified.
    """
    if angle == 0.0:
        return xs, ys
    cx, cy = (x_min + x_max) / 2.0, (y_min + y_max) / 2.0
    rad = math.radians(-angle)
    c, s = math.cos(rad), math.sin(rad)
    dx, dy = xs - cx, ys - cy
    xr = cx + dx * c - dy * s
    yr = cy + dx * s + dy * c
    return np.asarray(xr, dtype=float), np.asarray(yr, dtype=float)


def _axis_mask(
    coord: NDArray[np.float64], lo: float, hi: float, wrapped: bool
) -> tuple[NDArray[np.bool_], NDArray[np.float64], float]:
    """One axis's selection mask + the coordinate to bin against -> ``(mask,
    coord_for_binning, span)``.

    Non-wrapped: a plain ``[lo, hi]`` range mask, coordinate unchanged,
    ``span = hi - lo``. Wrapped: :func:`quantized.calc._rsm_grid.wrap_mask`'s
    rebase -- the REBASED coordinate (in ``[0, span)``) is what gets
    returned/binned, the same trick ``chi_profile`` uses to keep a wrapping
    axis monotonic across the seam instead of jumping from 360 back to 0
    mid-profile.
    """
    if wrapped:
        mask, span, rebased = wrap_mask(coord, lo, hi)
        return mask, rebased, span
    mask = np.asarray((coord >= lo) & (coord <= hi), dtype=bool)
    return mask, coord, hi - lo


def _reduce_lines(
    sub: NDArray[np.float64], axis: int, reduce: str
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Reduce the grid-path submatrix along ``axis`` -> ``(profile, counts)``.

    ``counts`` is the number of FINITE cells per output line (the grid-path
    equivalent of the cloud path's per-bin point count). ``reduce="sum"``
    uses ``nansum`` (an all-NaN line -> 0, matching ``sectorcut``'s
    empty-bin convention for sums); ``"mean"``/``"max"`` use
    ``nanmean``/``nanmax`` (an all-NaN line -> NaN). numpy warns on an
    all-NaN ``nanmean``/``nanmax`` slice ("Mean of empty slice" etc.) even
    though NaN is exactly the intended, documented result here --
    suppressed the same way ``calc/map.py``'s ``_finite_extreme`` avoids it
    for a scalar reduction.
    """
    counts = np.asarray(np.sum(np.isfinite(sub), axis=axis), dtype=float)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        if reduce == "sum":
            profile = np.nansum(sub, axis=axis)
        elif reduce == "mean":
            profile = np.nanmean(sub, axis=axis)
        else:
            profile = np.nanmax(sub, axis=axis)
    return np.asarray(profile, dtype=float), counts


def _box_label(
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    collapse: str,
    reduce: str,
    angle: float,
    wrap: str | None,
) -> str:
    label = f"Box x=[{x_min:.4g}, {x_max:.4g}] y=[{y_min:.4g}, {y_max:.4g}] {reduce}→{collapse}"
    if angle != 0.0:
        label += f" @{angle:.4g} deg"
    if wrap:
        label += f" wrap={wrap}"
    return label


def _grid_box(
    ds: DataStruct,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    collapse: str,
    reduce: str,
) -> tuple[NDArray[np.float64], NDArray[np.float64], str, str, str, int]:
    """Exact grid-path selection -- see the module docstring's "Grid path".

    Returns ``(x, values, x_name, x_unit, intensity_unit, n_lines)``.
    """
    g = full_grids(ds)
    sel_y = np.mean(g["sec"], axis=1)
    sel_x = np.mean(g["tt"], axis=0)
    row_mask = (sel_y >= y_min) & (sel_y <= y_max)
    col_mask = (sel_x >= x_min) & (sel_x <= x_max)
    if not row_mask.any() or not col_mask.any():
        raise ValueError("box selects no data")

    sub = g["i"][np.ix_(row_mask, col_mask)]
    if collapse == "x":
        profile, counts = _reduce_lines(sub, axis=0, reduce=reduce)
        x = sel_x[col_mask]
        x_name, n_lines = str(g["tt_name"]), int(row_mask.sum())
    else:
        profile, counts = _reduce_lines(sub, axis=1, reduce=reduce)
        x = sel_y[row_mask]
        x_name, n_lines = str(g["sec_name"]), int(col_mask.sum())

    values = np.column_stack([profile, counts])
    return x, values, x_name, "deg", str(g["unit"]), n_lines


def _cloud_box(
    ds: DataStruct,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    space: str,
    collapse: str,
    reduce: str,
    n_bins: int | None,
    angle: float,
    wrap: str | None,
) -> tuple[NDArray[np.float64], NDArray[np.float64], str, str, str, int]:
    """Mask + bin the scattered cloud -- see the module docstring's "Cloud
    path". Returns ``(x, values, x_name, x_unit, intensity_unit, n_bins)``.
    ``x_name`` is whichever of ``scatter_columns``'s resolved
    ``(col_x_name, col_y_name)`` the ``collapse`` direction selects -- e.g.
    ``Phi``/``Psi`` for a pole figure, never a hardcoded ``"2Theta"``
    (RSM_CUTS_PLAN item 19).
    """
    xs, ys, intensity, axis_unit, intensity_unit, col_x_name, col_y_name = scatter_columns(
        ds, space
    )
    xs = np.asarray(xs, dtype=float)
    ys = np.asarray(ys, dtype=float)
    intensity = np.asarray(intensity, dtype=float)
    xs, ys = _rotate(xs, ys, x_min, x_max, y_min, y_max, angle)

    x_mask, x_coord, x_span = _axis_mask(xs, x_min, x_max, wrap == "x")
    y_mask, y_coord, y_span = _axis_mask(ys, y_min, y_max, wrap == "y")
    mask = x_mask & y_mask & np.isfinite(intensity)
    if not np.any(mask):
        raise ValueError("box selects no data")

    bins = n_bins if n_bins is not None else _DEFAULT_N_BINS
    if collapse == "x":
        coord = x_coord[mask]
        edge_lo, edge_hi = (0.0, x_span) if wrap == "x" else (x_min, x_max)
        offset = x_min if wrap == "x" else 0.0
        x_name = col_x_name
    else:
        coord = y_coord[mask]
        edge_lo, edge_hi = (0.0, y_span) if wrap == "y" else (y_min, y_max)
        offset = y_min if wrap == "y" else 0.0
        x_name = col_y_name

    edges = np.linspace(edge_lo, edge_hi, bins + 1)
    iv = intensity[mask]
    profile = np.asarray(
        binned_statistic(coord, iv, statistic=reduce, bins=edges).statistic, dtype=float
    )
    counts = np.asarray(
        binned_statistic(coord, iv, statistic="count", bins=edges).statistic, dtype=float
    )
    centres = offset + (edges[:-1] + edges[1:]) / 2.0
    values = np.column_stack([profile, counts])
    return centres, values, x_name, axis_unit, intensity_unit, bins


def box_cut(
    ds: DataStruct,
    *,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    space: str = "angular",
    collapse: str = "x",
    reduce: str = "sum",
    n_bins: int | None = None,
    angle: float = 0.0,
    wrap: str | None = None,
) -> DataStruct:
    """Bounded rectangular integration, collapsed onto one axis.

    ``collapse="x"`` (default) produces intensity vs the horizontal axis
    (2Theta, or Qx in Q-space), integrating over every selected y line;
    ``collapse="y"`` is the transpose (vs the vertical axis, integrating
    over x). ``reduce`` picks how each output line/bin combines its
    perpendicular cells: ``"sum"`` (default), ``"mean"``, or ``"max"``.

    Takes the EXACT grid path (see the module docstring) whenever
    ``space="angular"``, the dataset carries ``metadata.map_shape``, and
    neither ``angle`` nor ``wrap`` is set; otherwise masks and bins the
    scattered cloud (``n_bins``, default 200). ``angle`` (degrees) rotates
    the selection about the ROI's own centre -- the cut-ruler backend for
    radial/transverse cuts about a peak; forces the cloud path. ``wrap``
    (``"x"``/``"y"``/``None``) treats that axis as periodic (mod 360),
    letting a box straddle e.g. a pole figure's Phi 360->0 seam; also forces
    the cloud path. When ``wrap`` names an axis, THAT axis's bounds may be
    given in either order (``lo > hi`` is the normal way to express "wrap
    through the seam", exactly like ``sector_profile``'s ``phi_min``/
    ``phi_max``); the other axis must still have ``max > min``.

    Returns a 2-column ``DataStruct`` (``labels=["Intensity", "N points"]``)
    via :func:`quantized.calc._rsm_grid.cut_result` -- the same assembler
    ``linecut.py``/``sectorcut.py`` use. See the module docstring for the
    "N points" uncertainty caveat.

    Raises ``ValueError`` for an unknown ``space``/``collapse``/``reduce``/
    ``wrap``, bad bounds ordering (on a non-wrapped axis), ``n_bins < 2``,
    or when the box selects no data.
    """
    if collapse not in _COLLAPSE:
        raise ValueError(f"collapse must be one of {_COLLAPSE}, got {collapse!r}")
    if reduce not in _REDUCE:
        raise ValueError(f"reduce must be one of {_REDUCE}, got {reduce!r}")
    if n_bins is not None and n_bins < 2:
        raise ValueError("n_bins must be >= 2")
    _validate_space_wrap(space, wrap)
    _validate_angle(angle)
    _validate_bounds(x_min, x_max, y_min, y_max, wrap)

    use_grid = (
        space == "angular"
        and angle == 0.0
        and wrap is None
        and bool(ds.metadata.get("is2D"))
        and bool(ds.metadata.get("map_shape"))
    )
    if use_grid:
        x, values, x_name, x_unit, unit, n_lines = _grid_box(
            ds, x_min, x_max, y_min, y_max, collapse, reduce
        )
        cut_space = "angular"
    else:
        x, values, x_name, x_unit, unit, n_lines = _cloud_box(
            ds, x_min, x_max, y_min, y_max, space, collapse, reduce, n_bins, angle, wrap
        )
        cut_space = space

    label = _box_label(x_min, x_max, y_min, y_max, collapse, reduce, angle, wrap)
    return cut_result(
        x,
        values,
        label=label,
        x_name=x_name,
        x_unit=x_unit,
        unit=[unit, ""],
        ds=ds,
        labels=["Intensity", "N points"],
        parser_name="box_cut",
        extra={
            "cut_kind": "box",
            "roi": [x_min, x_max, y_min, y_max],
            "cut_space": cut_space,
            "reduce": reduce,
            "collapse": collapse,
            "angle": angle,
            "wrap": wrap,
            "n_bins_or_lines": n_lines,
        },
    )


def box_stats(
    ds: DataStruct,
    *,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    space: str = "angular",
    angle: float = 0.0,
    wrap: str | None = None,
) -> dict[str, Any]:
    """Scalar summary (the "paper numbers") over a rectangular ROI.

    Always works over the scattered cloud (``_rsm_grid.scatter_columns``) --
    unlike :func:`box_cut` there is no binned profile to keep exact, so the
    grid/cloud distinction does not apply here: every selected point's own
    (x, y, Intensity) triple is used directly. ``angle``/``wrap`` apply the
    same rotation/periodic-axis rules as :func:`box_cut` (see its
    docstring).

    Returns a dict (not a ``DataStruct`` -- scalars, the ``rsm_strain``
    precedent): ``n_points``, ``integrated_intensity`` (raw sum, see the
    module docstring's uncertainty note for when ``sqrt`` of it is a valid
    Poisson error), ``mean_intensity``, ``max_intensity``, ``peak_x``/
    ``peak_y`` (the coordinates of the single brightest selected point),
    ``centroid_x``/``centroid_y`` (intensity-weighted mean position, RAW
    Intensity as weights -- see the module docstring), plus the echoed
    ``x_min``/``x_max``/``y_min``/``y_max``/``space``/``angle``/``wrap``.

    Raises ``ValueError`` for an unknown ``space``/``wrap``, bad bounds
    ordering (on a non-wrapped axis), or when the box selects no data.
    """
    _validate_space_wrap(space, wrap)
    _validate_angle(angle)
    _validate_bounds(x_min, x_max, y_min, y_max, wrap)

    xs, ys, intensity, _axis_unit, _intensity_unit, _x_name, _y_name = scatter_columns(ds, space)
    xs = np.asarray(xs, dtype=float)
    ys = np.asarray(ys, dtype=float)
    intensity = np.asarray(intensity, dtype=float)
    xs, ys = _rotate(xs, ys, x_min, x_max, y_min, y_max, angle)

    x_mask, _x_coord, _x_span = _axis_mask(xs, x_min, x_max, wrap == "x")
    y_mask, _y_coord, _y_span = _axis_mask(ys, y_min, y_max, wrap == "y")
    mask = x_mask & y_mask & np.isfinite(intensity)
    if not np.any(mask):
        raise ValueError("box selects no data")

    xv, yv, iv = xs[mask], ys[mask], intensity[mask]
    peak_idx = int(np.argmax(iv))
    weight_sum = float(np.sum(iv))
    if weight_sum != 0.0:
        centroid_x = float(np.sum(xv * iv) / weight_sum)
        centroid_y = float(np.sum(yv * iv) / weight_sum)
    else:
        centroid_x = float(np.mean(xv))
        centroid_y = float(np.mean(yv))

    return {
        "n_points": int(iv.size),
        "integrated_intensity": float(np.sum(iv)),
        "mean_intensity": float(np.mean(iv)),
        "max_intensity": float(iv[peak_idx]),
        "peak_x": float(xv[peak_idx]),
        "peak_y": float(yv[peak_idx]),
        "centroid_x": centroid_x,
        "centroid_y": centroid_y,
        "x_min": x_min,
        "x_max": x_max,
        "y_min": y_min,
        "y_max": y_max,
        "space": space,
        "angle": angle,
        "wrap": wrap,
    }
