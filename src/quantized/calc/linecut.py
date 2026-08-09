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
snapshot / coupled). Segment cuts interpolate the scattered cloud directly
and need no grid. Every function returns a 1-D ``DataStruct`` ready for the
library (plot, fit, export like any scan).

The shared (N, M) grid reshape, the space -> (x, y, Intensity) scattered-
column selection, and the result-assembly helper used here now live in
``calc/_rsm_grid.py`` (RSM_CUTS_PLAN item 1), so ``calc/sectorcut.py``
(arc/chi profiles) and ``calc/boxcut.py`` (box integration) build on the
exact same primitives instead of drifting copies — see that module's
docstring.
"""

from __future__ import annotations

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
    Q-space) at the frame(s) nearest ``value`` on the vertical axis.
    ``direction='v'``: intensity vs the vertical axis (secondary motor, or Qz)
    at the pixel column(s) nearest ``value`` on the horizontal axis.

    ``width=0`` reproduces MATLAB's single nearest-line cut; ``width>0``
    averages every line whose axis value lies within ±width/2 of ``value``
    (falls back to the nearest single line when none do).
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

    if direction == "h":
        sel = np.mean(g["sec"] if space == "angular" else g["qz"], axis=1)
        x_grid = g["tt"] if space == "angular" else g["qx"]
        pick = np.abs(sel - value) <= width / 2.0
        if not pick.any():
            pick = np.zeros(sel.size, dtype=bool)
            pick[int(np.argmin(np.abs(sel - value)))] = True
        x = np.mean(x_grid[pick, :], axis=0)
        y = np.mean(g["i"][pick, :], axis=0)
        fixed_name = g["sec_name"] if space == "angular" else "Qz"
        x_name = "2Theta" if space == "angular" else "Qx"
    else:
        sel = np.mean(g["tt"] if space == "angular" else g["qx"], axis=0)
        x_grid = g["sec"] if space == "angular" else g["qz"]
        pick = np.abs(sel - value) <= width / 2.0
        if not pick.any():
            pick = np.zeros(sel.size, dtype=bool)
            pick[int(np.argmin(np.abs(sel - value)))] = True
        x = np.mean(x_grid[:, pick], axis=1)
        y = np.mean(g["i"][:, pick], axis=1)
        fixed_name = "2Theta" if space == "angular" else "Qx"
        x_name = g["sec_name"] if space == "angular" else "Qz"

    unit_ax = "deg" if space == "angular" else "Ang^-1"
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
