"""Volume of a map over a region of interest (Origin's ``integ2`` on a ROI).

The map must be a regular grid (``_map_points.read_points``); a scattered
cloud is refused, never interpolated behind the user's back. A cell belongs to
the region when its CENTRE is inside it (rectangle: inclusive, with a 1e-9
tolerance of the axis span; polygon: even-odd rule). The volume is the sum of
``(z - background) * dx * dy`` over those cells, the area is
``cells * dx * dy``. That is the ``"pixel"`` rule (default): every pixel is a
full cell.

``rule="trapezoid"`` is Origin's ``integ2`` convention instead: the trapezoid
rule over the grid NODES, i.e. over the cells BETWEEN pixel centres. A cell
counts when all four corners are in the region, and contributes
``mean(corner values - background) * dx * dy``; ``area`` is the summed cell
area and ``n_cells`` the number of those cells. Over a whole map this is
(nx-1)(ny-1) cells and loses half a pixel on every edge, which is why it reads
a few percent lower than the pixel rule on a coarse grid.

Background, subtracted cell by cell:

* ``none``     -- nothing (the raw volume);
* ``constant`` -- the given ``value``, or, with none given, the mean of the
  border ring;
* ``plane``    -- ``a x + b y + c`` least-squares fitted to the border ring.

The border ring is the region's outermost ``border`` cells (default 2), so
the ROI is expected to enclose the feature with some flat margin around it.
A fit that cannot be made (fewer than 3 ring cells, or all collinear) is
refused.

Fail closed: an empty region is refused; cells with no finite value inside it
are refused unless ``on_nan = "skip"``, which drops them and reports how many.

Pure layer: ``MapPoints`` / DataStruct in, dict / DataStruct out.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import binary_erosion

from quantized.calc._map_points import MapPoints, read_points
from quantized.datastruct import DataStruct

__all__ = ["map_volume_from_datastruct", "roi_volume", "volume_table_datastruct"]

_Arr = NDArray[np.float64]


def _in_polygon(x: _Arr, y: _Arr, poly: _Arr) -> NDArray[np.bool_]:
    """Even-odd point-in-polygon for arrays of points."""
    inside = np.zeros(x.shape, dtype=bool)
    xj, yj = poly[-1]
    for xi, yi in poly:
        crosses = (yi > y) != (yj > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_at = (xj - xi) * (y - yi) / (yj - yi) + xi
        inside ^= crosses & (x < x_at)
        xj, yj = xi, yi
    return inside


def _region_mask(gx: _Arr, gy: _Arr, region: dict[str, Any]) -> NDArray[np.bool_]:
    kind = region.get("kind")
    if kind == "rect":
        try:
            xa, xb = sorted((float(region["x0"]), float(region["x1"])))
            ya, yb = sorted((float(region["y0"]), float(region["y1"])))
        except (KeyError, TypeError, ValueError):
            raise ValueError("a rectangle region needs numeric x0, x1, y0 and y1") from None
        if not all(np.isfinite([xa, xb, ya, yb])):
            raise ValueError("the rectangle bounds must be finite")
        tx = 1e-9 * max(float(np.ptp(gx)), 1e-300)
        ty = 1e-9 * max(float(np.ptp(gy)), 1e-300)
        return np.asarray(
            (gx >= xa - tx) & (gx <= xb + tx) & (gy >= ya - ty) & (gy <= yb + ty), dtype=bool
        )
    if kind == "polygon":
        try:
            poly = np.asarray(region["points"], dtype=float)
        except (KeyError, TypeError, ValueError):
            raise ValueError("a polygon region needs a list of [x, y] points") from None
        if poly.ndim != 2 or poly.shape[1] != 2 or poly.shape[0] < 3:
            raise ValueError("a polygon needs at least 3 [x, y] vertices")
        if not np.isfinite(poly).all():
            raise ValueError("the polygon vertices must be finite")
        return _in_polygon(gx, gy, poly)
    raise ValueError("region.kind must be 'rect' or 'polygon'")


def _background(
    bg: dict[str, Any],
    gx: _Arr,
    gy: _Arr,
    gz: _Arr,
    mask: NDArray[np.bool_],
    border: int,
) -> tuple[_Arr, dict[str, Any]]:
    """The background surface over the grid and a description of it."""
    kind = bg.get("kind", "none")
    if kind == "none":
        return np.zeros_like(gz), {"kind": "none"}
    if kind not in ("constant", "plane"):
        raise ValueError("background.kind must be 'none', 'constant' or 'plane'")
    if kind == "constant" and bg.get("value") is not None:
        v = float(bg["value"])
        if not np.isfinite(v):
            raise ValueError("the constant background must be a finite number")
        return np.full_like(gz, v), {"kind": "constant", "value": v, "source": "given"}
    inner = binary_erosion(mask, iterations=border, border_value=0)
    ring = mask & ~inner & np.isfinite(gz)
    n = int(ring.sum())
    if kind == "constant":
        if n < 1:
            raise ValueError("no finite cells in the border ring to estimate the background")
        v = float(gz[ring].mean())
        return np.full_like(gz, v), {"kind": "constant", "value": v, "source": "border mean"}
    if n < 3:
        raise ValueError(f"a plane background needs at least 3 border cells, found {n}")
    x0, y0 = float(gx[mask].mean()), float(gy[mask].mean())
    design = np.column_stack([gx[ring] - x0, gy[ring] - y0, np.ones(n)])
    if np.linalg.matrix_rank(design) < 3:
        raise ValueError("the border cells are collinear; a plane background cannot be fitted")
    coef = np.linalg.lstsq(design, gz[ring], rcond=None)[0]
    surface = coef[0] * (gx - x0) + coef[1] * (gy - y0) + coef[2]
    return np.asarray(surface, dtype=float), {
        "kind": "plane",
        "a": float(coef[0]),
        "b": float(coef[1]),
        "c": float(coef[2] - coef[0] * x0 - coef[1] * y0),
        "source": "border fit",
    }


def _trapezoid_sums(
    ux: _Arr, uy: _Arr, gz: _Arr, surface: _Arr, use: NDArray[np.bool_]
) -> tuple[float, float, float, int]:
    """``(raw, background, area, n_cells)`` of the trapezoid rule over the cells
    whose four corner nodes are all in ``use``."""
    full = use[:-1, :-1] & use[1:, :-1] & use[:-1, 1:] & use[1:, 1:]
    n_cells = int(full.sum())
    if not n_cells:
        raise ValueError(
            "the trapezoid rule needs at least one cell between four selected pixels; "
            "widen the region, or use the pixel rule"
        )
    area_w = np.where(full, np.outer(np.diff(uy), np.diff(ux)), 0.0)

    def integral(a: _Arr) -> float:
        corners = (a[:-1, :-1] + a[1:, :-1] + a[:-1, 1:] + a[1:, 1:]) / 4.0
        return float(np.sum(np.where(full, corners, 0.0) * area_w))

    return integral(gz), integral(surface), float(area_w.sum()), n_cells


def roi_volume(
    pts: MapPoints,
    region: dict[str, Any],
    background: dict[str, Any] | None = None,
    *,
    border: int = 2,
    on_nan: str = "refuse",
    rule: str = "pixel",
) -> dict[str, Any]:
    """Integrate the map over ``region``; ``ValueError`` with the reason on bad input."""
    if pts.grid is None or pts.ux is None or pts.uy is None:
        raise ValueError(
            "volume integration needs a map on a regular grid; this one is a scattered "
            "point cloud (for an RSM, choose the angular axes rather than Q space)"
        )
    if on_nan not in ("refuse", "skip"):
        raise ValueError("on_nan must be 'refuse' or 'skip'")
    if rule not in ("pixel", "trapezoid"):
        raise ValueError("rule must be 'pixel' or 'trapezoid'")
    if border < 1:
        raise ValueError("border must be at least 1 cell")
    gx, gy = np.meshgrid(pts.ux, pts.uy)
    gz = pts.grid
    mask = _region_mask(gx, gy, region)
    if not mask.any():
        raise ValueError("the region contains no cells of the map (is it inside the map?)")
    bad = mask & ~np.isfinite(gz)
    n_nan = int(bad.sum())
    if n_nan and on_nan == "refuse":
        raise ValueError(
            f"{n_nan} of {int(mask.sum())} cells in the region have no value; "
            "shrink the region or choose to skip them"
        )
    use = mask & ~bad
    if not use.any():
        raise ValueError("every cell in the region is empty")
    surface, bg_info = _background(background or {}, gx, gy, gz, use, border)
    if rule == "trapezoid":
        raw, bg_vol, area, n_cells = _trapezoid_sums(
            pts.ux, pts.uy, np.where(use, gz, 0.0), surface, use
        )
    else:
        cell = float(np.median(np.diff(pts.ux)) * np.median(np.diff(pts.uy)))
        n_cells = int(use.sum())
        raw = float(gz[use].sum() * cell)
        bg_vol = float(surface[use].sum() * cell)
        area = n_cells * cell
    vol = raw - bg_vol
    return {
        "volume": vol,
        "raw_volume": raw,
        "background_volume": bg_vol,
        "area": area,
        "n_cells": n_cells,
        "n_nan": n_nan,
        "rule": rule,
        "mean": vol / area,
        "background": bg_info,
        "region": dict(region),
        "x_label": pts.x_label,
        "x_unit": pts.x_unit,
        "y_label": pts.y_label,
        "y_unit": pts.y_unit,
        "z_unit": pts.z_unit,
    }


def map_volume_from_datastruct(
    ds: DataStruct,
    region: dict[str, Any],
    background: dict[str, Any] | None = None,
    *,
    x_col: int | str | None = None,
    y_col: int | str | None = None,
    z_col: int | str | None = None,
    border: int = 2,
    on_nan: str = "refuse",
    rule: str = "pixel",
) -> dict[str, Any]:
    """:func:`roi_volume` on a map DataStruct's chosen columns."""
    return roi_volume(
        read_points(ds, x_col, y_col, z_col),
        region,
        background,
        border=border,
        on_nan=on_nan,
        rule=rule,
    )


def volume_table_datastruct(result: dict[str, Any], source: str = "") -> DataStruct:
    """The result as a one-row table DataStruct carrying the settings in metadata."""
    xu, yu, zu = result["x_unit"], result["y_unit"], result["z_unit"]
    area_u = " ".join(u for u in (xu, yu) if u)
    cols = [
        ("Volume", " ".join(u for u in (zu, xu, yu) if u), result["volume"]),
        ("Area", area_u, result["area"]),
        ("Cells", "", float(result["n_cells"])),
        ("Mean", zu, result["mean"]),
        ("Background volume", " ".join(u for u in (zu, xu, yu) if u), result["background_volume"]),
    ]
    meta = {
        "map_volume": {
            "source": source,
            "region": result["region"],
            "background": result["background"],
            "n_nan": result["n_nan"],
            "rule": result["rule"],
            **{
                k: result[k]
                for k in ("volume", "raw_volume", "background_volume", "area", "n_cells", "mean")
            },
        },
        "x_column_name": "ROI",
    }
    return DataStruct.create(
        np.array([1.0]),
        np.array([[c[2] for c in cols]], dtype=float),
        labels=[c[0] for c in cols],
        units=[c[1] for c in cols],
        metadata=meta,
    )
