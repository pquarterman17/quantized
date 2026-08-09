"""Line cuts + projections from 2-D RSM DataStructs (ORIGIN_GAP_PLAN #18/#46).

Port + extension of MATLAB ``+bosonPlotter/extract2DLineCut.m``. The MATLAB
reference offered single nearest-row/column cuts (Shift/Ctrl+click) in angular
or Q space. Extended here:

- **width-averaged cuts** (``width > 0`` averages every row/column whose axis
  value falls within ±width/2 — a swath, not one detector line);
- **arbitrary segment cuts** (:func:`cut_segment` — any angle through the
  cloud, distance-parametrized, with optional perpendicular averaging);
- **integrated projections** (:func:`projection` — the full-map sum onto
  either axis; the "pixels" direction reproduces MATLAB's integrated 1-D
  fallback ``sum(intensityMap, 1)``).

Cuts work on the (frames × pixels) index grid via ``metadata.map_shape``, so
they are exact detector-line extractions for all three mesh kinds (mesh /
snapshot / coupled) IN ANGULAR SPACE, where a row/column genuinely IS
constant-omega / constant-2Theta. Segment cuts interpolate the scattered
cloud directly and need no grid. Every function returns a 1-D ``DataStruct``
ready for the library (plot, fit, export like any scan).

**RSM_CUTS_PLAN item 2 fix (this revision):** :func:`line_cut`'s
``space="q"`` path used to pick one whole grid row/column by nearest MEAN
Qz/Qx and label it a "fixed Q" cut. That is wrong: the (2Theta, Omega) grid
is curvilinear in reciprocal space (a rectangular angular mesh is a curved
fan in Q), so one detector row's actual Qz sweeps 79-99% of the map's WHOLE
Qz range, not a value near its mean (measured on the real corpus: epytaxy
98.1%, xrayutilities pixcel 98.8%, test_area 79.1% -- see
``tests/test_calc_linecut.py``). Whole-row/column selection is now used
ONLY for ``space="angular"`` (unchanged, still exact). For ``space="q"``,
:func:`line_cut` now masks a perpendicular BAND around the requested Qz/Qx
over the scattered cloud and bins along the free coordinate -- the same
mask-and-bin treatment ``calc.boxcut``'s Q-space path uses (item 3). See
:func:`line_cut`'s docstring for the exact band-width semantics. This
mirrors a latent, unfixed bug in the MATLAB reference
(``+bosonPlotter/extract2DLineCut.m:40-42``: ``meanQz = mean(map.Qz, 2);
[~, rowIdx] = min(abs(meanQz - clickY))``) that the original port
replicated faithfully; per the sibling-repo-first rule the MATLAB side is
REPORTED, not fixed, here -- see ``plans/PORT_CHECKLIST.md``.

The shared (N, M) grid reshape, the space -> (x, y, Intensity) scattered-
column selection, and the result-assembly helper used here live in
``calc/_rsm_grid.py`` (RSM_CUTS_PLAN item 1), so ``calc/sectorcut.py``
(arc/chi profiles) and ``calc/boxcut.py`` (box integration) build on the
exact same primitives instead of drifting copies — see that module's
docstring.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc._rsm_grid import SPACES, cut_result, full_grids, require_q, scatter_columns
from quantized.calc.interp2d import interpolate2d
from quantized.datastruct import DataStruct

__all__ = ["cut_segment", "line_cut", "projection"]


def line_cut(
    ds: DataStruct,
    *,
    direction: str,
    value: float,
    space: str = "angular",
    width: float = 0.0,
) -> DataStruct:
    """Horizontal / vertical cut through the map at a fixed axis value.

    ``direction='h'``: intensity vs the horizontal axis (2Theta, or Qx in
    Q-space) at fixed ``value`` on the vertical axis (secondary motor, or
    Qz). ``direction='v'``: intensity vs the vertical axis at fixed
    ``value`` on the horizontal axis (2Theta, or Qx).

    **Angular space** (``space='angular'``, unchanged): the (frames x
    pixels) grid is axis-aligned -- rows genuinely ARE constant-omega and
    columns constant-2Theta -- so a cut is an EXACT grid-line selection.
    ``width=0`` reproduces MATLAB ``extract2DLineCut``'s single
    nearest-line cut; ``width>0`` averages every line whose axis value
    lies within +-width/2 of ``value`` (falls back to the nearest single
    line when none do).

    **Q space** (``space='q'``, RSM_CUTS_PLAN item 2): the (2Theta, Omega)
    grid is curvilinear in reciprocal space, so unlike angular space a
    single detector row/column does NOT have a nearly-constant Qz/Qx --
    selecting a whole grid line by nearest mean-Q (this function's
    pre-fix behaviour, and the MATLAB reference's behaviour to this day;
    see the module docstring) silently returns a profile that sweeps most
    of the map's Q range instead of a fixed-Q line. Fixed here as an
    honest perpendicular BAND MASK over the scattered (Qx, Qz) cloud,
    binned along the free coordinate -- the same mask-and-bin treatment
    ``calc.boxcut``'s Q-space path uses: ``direction='h'`` masks
    ``|Qz - value| <= width/2`` and bins Qx into ``map_shape[1]`` bins
    (mean per bin, NaN where a bin has no points); ``direction='v'``
    mirrors it (mask Qx, bin Qz into ``map_shape[0]`` bins). ``width`` in
    Q space is therefore a genuine BAND HALF-WIDTH IN Ang^-1 -- a physical
    quantity, unlike angular space where it counts grid lines.
    ``width=0`` cannot select a zero-thickness band (no point sits at an
    exact Qz), so it auto-selects a single-detector-line-scale band
    instead: ``(Qz.max() - Qz.min()) / n_frames`` for ``direction='h'``
    (``(Qx.max() - Qx.min()) / n_pixels`` for ``'v'``) -- roughly the
    Q-space footprint of one detector line. The band actually applied is
    always recorded in the output metadata as ``cut_width_used`` (whether
    it came from ``width`` or the auto default), so a caller never has to
    guess it. Output is a single ``Intensity`` column in both spaces
    (consistent with this function's existing shape -- unlike the
    two-column ``[Intensity, "N points"]`` binned profiles in
    ``calc.sectorcut``/``calc.boxcut``); no uncertainty column is emitted.
    If Poisson error bars are needed, ``sigma = sqrt(sum(I))`` is
    defensible ONLY when ``ds.units`` reports raw counts -- never for
    counts-per-second (PANalytical XRDML often reports cps; scale by the
    counting time first).

    Raises ``ValueError`` for an unknown ``direction``/``space``, negative
    ``width``, a non-2-D or gridless dataset, missing Qx/Qz columns in Q
    space, or (Q space only) a fixed-Q band that selects no data.
    """
    if direction not in ("h", "v"):
        raise ValueError(f'direction must be "h" or "v", got "{direction}"')
    if space not in SPACES:
        raise ValueError(f"space must be one of {SPACES}, got {space!r}")
    if width < 0:
        raise ValueError("width must be >= 0")
    g = full_grids(ds)
    if space == "q":
        require_q(g)
        return _q_band_cut(ds, g, direction=direction, value=value, width=width)

    if direction == "h":
        sel = np.mean(g["sec"], axis=1)
        x_grid = g["tt"]
        pick = np.abs(sel - value) <= width / 2.0
        if not pick.any():
            pick = np.zeros(sel.size, dtype=bool)
            pick[int(np.argmin(np.abs(sel - value)))] = True
        x = np.mean(x_grid[pick, :], axis=0)
        y = np.mean(g["i"][pick, :], axis=0)
        fixed_name = g["sec_name"]
        x_name = "2Theta"
    else:
        sel = np.mean(g["tt"], axis=0)
        x_grid = g["sec"]
        pick = np.abs(sel - value) <= width / 2.0
        if not pick.any():
            pick = np.zeros(sel.size, dtype=bool)
            pick[int(np.argmin(np.abs(sel - value)))] = True
        x = np.mean(x_grid[:, pick], axis=1)
        y = np.mean(g["i"][:, pick], axis=1)
        fixed_name = "2Theta"
        x_name = g["sec_name"]

    unit_ax = "deg"
    centre = float(np.mean(sel[pick]))
    tag = "H-cut" if direction == "h" else "V-cut"
    label = f"{tag} {fixed_name}≈{centre:.6g} {unit_ax}"
    if width > 0:
        label += f" ±{width / 2:.4g}"
    return cut_result(
        x, y, label=label, x_name=x_name, x_unit=unit_ax, unit=g["unit"], ds=ds,
        extra={"cut_direction": direction, "cut_value": centre,
               "cut_width": width, "cut_space": space, "n_lines": int(pick.sum())},
    )


def _q_band_cut(
    ds: DataStruct,
    g: dict[str, Any],
    *,
    direction: str,
    value: float,
    width: float,
) -> DataStruct:
    """Fixed-Qx/Qz cut: perpendicular-band mask + bin over the scattered Q cloud.

    The honest replacement for a curvilinear grid's nearest-mean-row/column
    selection -- see :func:`line_cut`'s docstring for the full semantics.
    """
    qx, qz, intensity, _axis_unit, intensity_unit = scatter_columns(ds, "q")
    n, m = g["qx"].shape

    if direction == "h":
        coord, free, n_bins, n_lines = qz, qx, m, n
        fixed_name, free_name = "Qz", "Qx"
    else:
        coord, free, n_bins, n_lines = qx, qz, n, m
        fixed_name, free_name = "Qx", "Qz"

    span = float(np.nanmax(coord) - np.nanmin(coord))
    w = width if width > 0 else (span / n_lines if n_lines > 0 else 0.0)
    mask = (
        (np.abs(coord - value) <= w / 2.0) & np.isfinite(coord) & np.isfinite(intensity)
    )
    if not mask.any():
        raise ValueError(
            f"no Q-space points within |{fixed_name} - {value:g}| <= {w / 2:g} Ang^-1 "
            "of the requested fixed-Q value (fixed-Q band selects no data)"
        )

    edges = np.linspace(float(np.nanmin(free)), float(np.nanmax(free)), n_bins + 1)
    sum_i, _ = np.histogram(free[mask], bins=edges, weights=intensity[mask])
    counts, _ = np.histogram(free[mask], bins=edges)
    with np.errstate(invalid="ignore", divide="ignore"):
        profile = np.asarray(np.where(counts > 0, sum_i / counts, np.nan), dtype=float)
    centres = (edges[:-1] + edges[1:]) / 2.0

    tag = "H-cut" if direction == "h" else "V-cut"
    label = f"{tag} {fixed_name}≈{value:.6g} Ang^-1 (band ±{w / 2:.4g} Ang^-1)"
    return cut_result(
        centres, profile, label=label, x_name=free_name, x_unit="Ang^-1",
        unit=intensity_unit, ds=ds,
        extra={
            "cut_direction": direction,
            "cut_value": value,
            "cut_width": width,
            "cut_width_used": w,
            "cut_space": "q",
            "n_points": int(mask.sum()),
        },
    )


def cut_segment(
    ds: DataStruct,
    *,
    p0: tuple[float, float],
    p1: tuple[float, float],
    n: int = 200,
    width: float = 0.0,
    space: str = "angular",
) -> DataStruct:
    """Arbitrary straight cut from ``p0`` to ``p1`` through the scattered cloud.

    Coordinates are ``(2Theta, <axis1>)`` for ``space='angular'`` or
    ``(Qx, Qz)`` for ``space='q'``. Samples ``n`` points along the segment by
    linear scattered interpolation; ``width>0`` additionally averages 7
    parallel lines spread over ±width/2 perpendicular to the cut (NaN outside
    the data hull is ignored). x = distance from ``p0``.
    """
    if space not in SPACES:
        raise ValueError(f"space must be one of {SPACES}, got {space!r}")
    if not ds.metadata.get("is2D"):
        raise ValueError("dataset is not a 2-D map (metadata.is2D not set)")
    if n < 2:
        raise ValueError("n must be >= 2")
    if width < 0:
        raise ValueError("width must be >= 0")
    xs, ys, iv, unit_ax, unit = scatter_columns(ds, space)

    d = np.asarray([p1[0] - p0[0], p1[1] - p0[1]], dtype=float)
    length = float(np.hypot(*d))
    if length <= 0:
        raise ValueError("p0 and p1 must be distinct points")
    d /= length
    perp = np.asarray([-d[1], d[0]])
    t = np.linspace(0.0, length, n)
    base_x = p0[0] + t * d[0]
    base_y = p0[1] + t * d[1]

    offsets = np.linspace(-width / 2.0, width / 2.0, 7) if width > 0 else np.asarray([0.0])
    xq = (base_x[None, :] + offsets[:, None] * perp[0]).ravel()
    yq = (base_y[None, :] + offsets[:, None] * perp[1]).ravel()
    zq = np.asarray(
        interpolate2d(xs, ys, iv, xq, yq, method="linear")["zq"], dtype=float
    ).reshape(offsets.size, n)
    with np.errstate(invalid="ignore"):
        y = np.nanmean(zq, axis=0)

    label = (
        f"Cut ({p0[0]:.5g}, {p0[1]:.5g})→({p1[0]:.5g}, {p1[1]:.5g}) "
        f"[{'Q' if space == 'q' else 'angular'}]"
    )
    if width > 0:
        label += f" ±{width / 2:.4g}"
    return cut_result(
        t, y, label=label, x_name="Distance", x_unit=unit_ax, unit=unit, ds=ds,
        extra={"cut_p0": list(p0), "cut_p1": list(p1), "cut_width": width,
               "cut_space": space, "cut_samples": int(n)},
    )


def projection(
    ds: DataStruct,
    *,
    axis: str = "pixels",
    space: str = "angular",
) -> DataStruct:
    """Integrate the whole map onto one axis.

    ``axis='pixels'``: sum over frames → intensity vs 2Theta (or Qx) — exactly
    MATLAB importXRDML's integrated 1-D fallback for a mesh.
    ``axis='frames'``: sum over pixels → intensity vs the secondary motor
    (or Qz) — a rocking-curve-like profile.
    """
    if axis not in ("pixels", "frames"):
        raise ValueError(f'axis must be "pixels" or "frames", got "{axis}"')
    if space not in SPACES:
        raise ValueError(f"space must be one of {SPACES}, got {space!r}")
    g = full_grids(ds)
    if space == "q":
        require_q(g)

    if axis == "pixels":
        x = np.mean(g["tt"] if space == "angular" else g["qx"], axis=0)
        y = np.sum(g["i"], axis=0)
        x_name = "2Theta" if space == "angular" else "Qx"
    else:
        x = np.mean(g["sec"] if space == "angular" else g["qz"], axis=1)
        y = np.sum(g["i"], axis=1)
        x_name = g["sec_name"] if space == "angular" else "Qz"

    unit_ax = "deg" if space == "angular" else "Ang^-1"
    label = f"Projection Σ{'frames' if axis == 'pixels' else 'pixels'} → I vs {x_name}"
    return cut_result(
        x, y, label=label, x_name=x_name, x_unit=unit_ax, unit=g["unit"], ds=ds,
        extra={"cut_axis": axis, "cut_space": space},
    )
